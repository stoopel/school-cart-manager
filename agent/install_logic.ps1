$OutputEncoding = [System.Console]::OutputEncoding = [System.Console]::InputEncoding = [System.Text.Encoding]::UTF8
Start-Transcript -Path "$PSScriptRoot\install_log.txt" -Append

Write-Host "Looking for configuration file..." -ForegroundColor Cyan
$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    $configPath = Join-Path $PSScriptRoot "dist\config.json"
}
if (-not (Test-Path $configPath)) {
    Write-Host "Error: config.json not found!" -ForegroundColor Red
    exit
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$supaUrl = $config.supabase_url
$supaKey = $config.supabase_key

if (-not $supaUrl -or -not $supaKey) {
    Write-Host "Error: config.json missing supabase_url or supabase_key!" -ForegroundColor Red
    exit
}

$computerName = [System.Net.Dns]::GetHostName()
$cartName = ""
$devNum = ""

# Pattern matching (e.g. 440294-NewYellow25)
if ($computerName -match '^(?:.*-)?(?:New|Old|Temp)?([A-Za-z]+)(\d+)$') {
    $cartName = $matches[1]
    $devNum = ([int]$matches[2]).ToString()
    
    Write-Host ""
    Write-Host "--- Auto Detection ---" -ForegroundColor Cyan
    Write-Host "Computer Name: $computerName"
    Write-Host "Detected Cart: $cartName"
    Write-Host "Detected Device Number: $devNum"
    Write-Host "-----------------------"
    Write-Host ""
    
    $confirm = Read-Host "Is this detection correct? (Y/N)"
    if ($confirm -notmatch '^[Yy]') {
        $cartName = ""
        $devNum = ""
    }
} else {
    Write-Host ""
    Write-Host "Could not automatically detect cart name and number from computer name ($computerName)" -ForegroundColor Yellow
    Write-Host ""
}

while ([string]::IsNullOrWhiteSpace($cartName)) {
    $cartName = Read-Host "Please enter the Cart Name (e.g. Yellow)"
}
while ([string]::IsNullOrWhiteSpace($devNum)) {
    $devNum = Read-Host "Please enter the Device Number in the cart (e.g. 25)"
}

Write-Host ""
Write-Host "Connecting to Database..." -ForegroundColor Cyan

$headers = @{
    "apikey" = $supaKey
    "Authorization" = "Bearer $supaKey"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation"
}

# 1. Check if cart exists
$cartId = $null
try {
    $carts = Invoke-RestMethod -Uri "$supaUrl/rest/v1/carts?name=eq.$cartName" -Headers $headers -Method Get
    if ($carts.Count -gt 0) {
        $cartId = $carts[0].id
        Write-Host "[OK] Cart '$cartName' exists (ID: $cartId)" -ForegroundColor Green
    } else {
        Write-Host "Creating new cart: '$cartName'..." -ForegroundColor Yellow
        $body = @{ name = $cartName } | ConvertTo-Json
        $newCart = Invoke-RestMethod -Uri "$supaUrl/rest/v1/carts" -Headers $headers -Method Post -Body $body
        $cartId = $newCart[0].id
        Write-Host "[OK] Cart created successfully." -ForegroundColor Green
    }
} catch {
    Write-Host "Supabase communication error: $_" -ForegroundColor Red
    exit
}

# 2. Check if device exists
$deviceId = $null
$assetTag = $computerName

try {
    $devices = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?asset_tag=eq.$assetTag" -Headers $headers -Method Get
    if ($devices.Count -eq 0) {
        $devices = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?cart_id=eq.$cartId&device_number=eq.$devNum" -Headers $headers -Method Get
    }

    if ($devices.Count -gt 0) {
        $deviceId = $devices[0].id
        Write-Host "[WARNING] Warning: Device already registered! Connecting to existing record..." -ForegroundColor Magenta
        
        # Update Asset Tag if connected via number and cart only
        if ($devices[0].asset_tag -ne $assetTag) {
            $updateBody = @{ asset_tag = $assetTag } | ConvertTo-Json
            Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?id=eq.$deviceId" -Headers $headers -Method Patch -Body $updateBody | Out-Null
        }
    } else {
        Write-Host "Registering new device in database..." -ForegroundColor Yellow
        $body = @{
            cart_id = $cartId
            device_number = [int]$devNum
            asset_tag = $assetTag
        } | ConvertTo-Json
        $newDev = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices" -Headers $headers -Method Post -Body $body
        $deviceId = $newDev[0].id
        Write-Host "[OK] Device registered successfully." -ForegroundColor Green
    }
} catch {
    Write-Host "Error registering device: $_" -ForegroundColor Red
    exit
}

# 3. Create Local Installation Directory and Copy Files
Write-Host ""
Write-Host "Preparing local installation folder..." -ForegroundColor Cyan
$localDir = "C:\CartAgent"
if (-not (Test-Path $localDir)) {
    New-Item -ItemType Directory -Path $localDir -Force | Out-Null
}

# Find Executable on USB
$sourceExe = Join-Path $PSScriptRoot "dist\cart_agent.exe"
if (-not (Test-Path $sourceExe)) {
    $sourceExe = Join-Path $PSScriptRoot "cart_agent.exe"
}

if (-not (Test-Path $sourceExe)) {
    Write-Host "Error: cart_agent.exe not found on installation media. Please ensure build.bat was run first!" -ForegroundColor Red
    exit
}

# Copy files locally
Write-Host "Copying files to $localDir..." -ForegroundColor Cyan
Copy-Item $sourceExe -Destination (Join-Path $localDir "cart_agent.exe") -Force

$sourceDll = Join-Path $PSScriptRoot "interception.dll"
if (Test-Path $sourceDll) {
    Copy-Item $sourceDll -Destination (Join-Path $localDir "interception.dll") -Force
    Write-Host "[OK] Copied interception.dll successfully." -ForegroundColor Green
}

$sourceInst = Join-Path $PSScriptRoot "install-interception.exe"
if (Test-Path $sourceInst) {
    Copy-Item $sourceInst -Destination (Join-Path $localDir "install-interception.exe") -Force
    Write-Host "[OK] Copied install-interception.exe successfully." -ForegroundColor Green
}

# Save data to local config
$localConfigPath = Join-Path $localDir "config.json"
$config.asset_tag = $assetTag
$config.cart_name = $cartName
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
$config | ConvertTo-Json -Depth 10 | Set-Content $localConfigPath -Encoding UTF8
Write-Host "[OK] Local configuration file updated." -ForegroundColor Green

# Check and install Interception Driver
$needsReboot = $false
$driverInstalled = (Test-Path "$env:windir\System32\drivers\interception.sys") -or (Get-Service -Name "Interception" -ErrorAction SilentlyContinue)

if (-not $driverInstalled) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host "Installing Kernel-Level Input Protection Driver (Veyon)..." -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Yellow
    
    $installPath = Join-Path $localDir "install-interception.exe"
    if (Test-Path $installPath) {
        Write-Host "Running driver installer..." -ForegroundColor Cyan
        # Run installer with /install argument
        Start-Process -FilePath $installPath -ArgumentList "/install" -WorkingDirectory $localDir -NoNewWindow -Wait
        Write-Host "[OK] Driver installation command executed." -ForegroundColor Green
        $needsReboot = $true
    } else {
        Write-Host "[WARNING] install-interception.exe not found! Skipping driver installation." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "[OK] Interception Kernel Driver is already installed." -ForegroundColor Green
}


# 4. Register in Windows Registry as User Shell (Instant Autostart)
Write-Host ""
Write-Host "Registering CartAgent in Windows Registry (User Shell)..." -ForegroundColor Cyan

# Remove old NSSM service if it exists (Clean up)
$serviceName = "CartAgent"
$localNssmPath = Join-Path $localDir "nssm.exe"
if (Test-Path $localNssmPath) {
    & $localNssmPath stop $serviceName 2>$null
    & $localNssmPath remove $serviceName confirm 2>$null
    Remove-Item $localNssmPath -Force 2>$null
}
# Also make sure to stop any running service via standard sc command if nssm is missing
sc.exe stop $serviceName 2>$null | Out-Null
sc.exe delete $serviceName 2>$null | Out-Null

# Clean up any old Run Key registrations to prevent duplicates
Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CartAgent" -ErrorAction SilentlyContinue | Out-Null
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CartAgent" -ErrorAction SilentlyContinue | Out-Null

# Clean up the elevated Administrator HKCU Shell registry entry if written previously
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "Shell" -ErrorAction SilentlyContinue | Out-Null

# Kill any existing cart_agent process to prevent file-lock
Stop-Process -Name "cart_agent" -Force 2>$null

# 5. Register custom shell for the currently logged-on user (e.g. Student account)
$exePath = Join-Path $localDir "cart_agent.exe"

# Resolve logged-on user
$loggedUser = (Get-CimInstance Win32_ComputerSystem).UserName
if ($loggedUser -and $loggedUser.Contains("\")) {
    $loggedUser = $loggedUser -split '\\' | Select-Object -Last 1
}
if (-not $loggedUser) {
    $explorerProc = Get-CimInstance -ClassName Win32_Process -Filter "Name='explorer.exe'" | Select-Object -First 1
    if ($explorerProc) {
        $owner = Invoke-CimMethod -InputObject $explorerProc -MethodName GetOwner
        $loggedUser = $owner.User
    }
}

$userSID = $null
if ($loggedUser) {
    $profilePath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\*"
    $userSID = (Get-ItemProperty -Path $profilePath | Where-Object { ($_.ProfileImagePath -split '\\' | Select-Object -Last 1) -eq $loggedUser }).PSChildName
}

$regPath = $null
if ($userSID) {
    $regPath = "Registry::HKEY_USERS\$userSID\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Write-Host "Resolved logged-on user: $loggedUser (SID: $userSID)" -ForegroundColor Green
} else {
    $regPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Write-Host "[WARNING] Could not resolve SID for active user. Falling back to current process context..." -ForegroundColor Yellow
}

try {
    # Ensure Winlogon subkey exists
    $parentPath = $regPath.Substring(0, $regPath.LastIndexOf('\'))
    if (-not (Test-Path $parentPath)) {
        New-Item -Path $parentPath.Substring(0, $parentPath.LastIndexOf('\')) -Name $parentPath.Substring($parentPath.LastIndexOf('\') + 1) -Force | Out-Null
    }
    if (-not (Test-Path $regPath)) {
        New-Item -Path $parentPath -Name "Winlogon" -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "Shell" -Value "`"$exePath`"" -Force | Out-Null
    Write-Host "[OK] Registered successfully as User Shell in Registry path: $regPath" -ForegroundColor Green
} catch {
    Write-Host "Error registering user Shell in Registry: $_" -ForegroundColor Red
    exit
}

# Start the agent immediately in the current user session
Write-Host "Starting CartAgent immediately..." -ForegroundColor Cyan
Start-Process -FilePath $exePath -WorkingDirectory $localDir

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "Installation completed successfully!" -ForegroundColor Green
Write-Host "The screen lock is now running in the background and registered to start automatically on boot." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

if ($needsReboot) {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Magenta
    Write-Host "ATTENTION: System Reboot Required!" -ForegroundColor Red
    Write-Host "To activate the newly installed kernel-level keyboard driver," -ForegroundColor Yellow
    Write-Host "you must restart your computer." -ForegroundColor Yellow
    Write-Host "======================================================================" -ForegroundColor Magenta
    Write-Host ""
    $choice = Read-Host "Would you like to restart the computer now? (Y/N)"
    if ($choice -match "^[yY]$") {
        Write-Host "Rebooting system..." -ForegroundColor Red
        Stop-Transcript
        Restart-Computer -Force
        exit
    } else {
        Write-Host "Please remember to restart the computer manually before testing!" -ForegroundColor Yellow
    }
}

Stop-Transcript
