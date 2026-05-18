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

$config = Get-Content $configPath -Raw | ConvertFrom-Json
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

# 3. Save data to local config
$config.asset_tag = $assetTag
$config.cart_name = $cartName
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
Write-Host "[OK] Local configuration file updated." -ForegroundColor Green


# 4. Register Windows Service
Write-Host ""
Write-Host "Installing system service (CartAgent)..." -ForegroundColor Cyan
$nssmPath = Join-Path $PSScriptRoot "nssm.exe"
if (-not (Test-Path $nssmPath)) {
    $nssmPath = Join-Path $PSScriptRoot "dist\nssm.exe"
}

if (-not (Test-Path $nssmPath)) {
    Write-Host "Downloading utility tool (NSSM)..." -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$PSScriptRoot\nssm.zip"
    Expand-Archive "$PSScriptRoot\nssm.zip" -Force -DestinationPath "$PSScriptRoot\nssm_temp"
    Copy-Item "$PSScriptRoot\nssm_temp\nssm-2.24\win64\nssm.exe" -Destination $PSScriptRoot
    $nssmPath = Join-Path $PSScriptRoot "nssm.exe"
    Remove-Item "$PSScriptRoot\nssm.zip" -Force
    Remove-Item "$PSScriptRoot\nssm_temp" -Recurse -Force
}

$serviceName = "CartAgent"
$exePath = Join-Path $PSScriptRoot "dist\cart_agent.exe"
if (-not (Test-Path $exePath)) {
    $exePath = Join-Path $PSScriptRoot "cart_agent.exe"
}

if (-not (Test-Path $exePath)) {
    Write-Host "Error: cart_agent.exe not found. Please ensure build.bat was run first!" -ForegroundColor Red
    exit
}

# Stop and remove service if exists
& $nssmPath stop $serviceName 2>$null
& $nssmPath remove $serviceName confirm 2>$null

# Reinstall
& $nssmPath install $serviceName "`"$exePath`""
& $nssmPath set $serviceName DisplayName "Cart Agent - Lock Screen"
& $nssmPath set $serviceName Description "School Laptop Cart Manager - Lock Screen"
& $nssmPath set $serviceName Start SERVICE_AUTO_START
& $nssmPath set $serviceName AppDirectory "`"$(Split-Path $exePath)`""

& $nssmPath start $serviceName

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "Installation completed successfully!" -ForegroundColor Green
Write-Host "The service is now running in the background and the computer is configured and connected." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

Stop-Transcript
