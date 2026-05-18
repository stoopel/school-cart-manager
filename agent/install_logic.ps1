$OutputEncoding = [System.Console]::OutputEncoding = [System.Console]::InputEncoding = [System.Text.Encoding]::UTF8
Start-Transcript -Path "$PSScriptRoot\install_log.txt" -Append

Write-Host "מחפש קובץ הגדרות..." -ForegroundColor Cyan
$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    $configPath = Join-Path $PSScriptRoot "dist\config.json"
}
if (-not (Test-Path $configPath)) {
    Write-Host "שגיאה: לא נמצא קובץ config.json!" -ForegroundColor Red
    exit
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$supaUrl = $config.supabase_url
$supaKey = $config.supabase_key

if (-not $supaUrl -or -not $supaKey) {
    Write-Host "שגיאה: קובץ config.json אינו מכיל supabase_url או supabase_key!" -ForegroundColor Red
    exit
}

$computerName = $env:COMPUTERNAME
$cartName = ""
$devNum = ""

# תבנית זיהוי (לדוגמה: 440294-NewYellow25 מפריד בין אותיות אנגלית למספר בסוף)
if ($computerName -match '^(?:.*-)?(?:New|Old|Temp)?([A-Za-z]+)(\d+)$') {
    $cartName = $matches[1]
    $devNum = $matches[2]
    
    Write-Host ""
    Write-Host "--- זיהוי אוטומטי ---" -ForegroundColor Cyan
    Write-Host "שם מחשב: $computerName"
    Write-Host "עגלה שזוהתה: $cartName"
    Write-Host "מספר מחשב שזוהה: $devNum"
    Write-Host "-----------------------"
    Write-Host ""
    
    $confirm = Read-Host "האם הזיהוי נכון? (Y/N)"
    if ($confirm -notmatch '^[Yy]') {
        $cartName = ""
        $devNum = ""
    }
} else {
    Write-Host ""
    Write-Host "לא הצלחתי לזהות אוטומטית את שם העגלה והמספר מתוך שם המחשב ($computerName)" -ForegroundColor Yellow
    Write-Host ""
}

while ([string]::IsNullOrWhiteSpace($cartName)) {
    $cartName = Read-Host "אנא הזן את שם העגלה (לדוגמה: Yellow)"
}
while ([string]::IsNullOrWhiteSpace($devNum)) {
    $devNum = Read-Host "אנא הזן את מספר המחשב בעגלה (לדוגמה: 25)"
}

Write-Host ""
Write-Host "מתחבר למסד הנתונים..." -ForegroundColor Cyan

$headers = @{
    "apikey" = $supaKey
    "Authorization" = "Bearer $supaKey"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation"
}

# 1. בודק אם העגלה קיימת
$cartId = $null
try {
    $carts = Invoke-RestMethod -Uri "$supaUrl/rest/v1/carts?name=eq.$cartName" -Headers $headers -Method Get
    if ($carts.Count -gt 0) {
        $cartId = $carts[0].id
        Write-Host "✔ עגלה '$cartName' קיימת (ID: $cartId)" -ForegroundColor Green
    } else {
        Write-Host "מייצר עגלה חדשה: '$cartName'..." -ForegroundColor Yellow
        $body = @{ name = $cartName } | ConvertTo-Json
        $newCart = Invoke-RestMethod -Uri "$supaUrl/rest/v1/carts" -Headers $headers -Method Post -Body $body
        $cartId = $newCart[0].id
        Write-Host "✔ העגלה נוצרה בהצלחה." -ForegroundColor Green
    }
} catch {
    Write-Host "שגיאה בתקשורת מול Supabase: $_" -ForegroundColor Red
    exit
}

# 2. בודק אם המחשב קיים
$deviceId = $null
$assetTag = $computerName

try {
    $devices = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?asset_tag=eq.$assetTag" -Headers $headers -Method Get
    if ($devices.Count -eq 0) {
        $devices = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?cart_id=eq.$cartId&device_number=eq.$devNum" -Headers $headers -Method Get
    }

    if ($devices.Count -gt 0) {
        $deviceId = $devices[0].id
        Write-Host "⚠ מחשב זה כבר רשום במערכת! מתחבר לרשומה הקיימת..." -ForegroundColor Magenta
        
        # עדכון השם (Asset Tag) למקרה שהתחברנו לפי מספר ועגלה בלבד
        if ($devices[0].asset_tag -ne $assetTag) {
            $updateBody = @{ asset_tag = $assetTag } | ConvertTo-Json
            Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices?id=eq.$deviceId" -Headers $headers -Method Patch -Body $updateBody | Out-Null
        }
    } else {
        Write-Host "רושם מחשב חדש במסד הנתונים..." -ForegroundColor Yellow
        $body = @{
            cart_id = $cartId
            device_number = [int]$devNum
            asset_tag = $assetTag
        } | ConvertTo-Json
        $newDev = Invoke-RestMethod -Uri "$supaUrl/rest/v1/devices" -Headers $headers -Method Post -Body $body
        $deviceId = $newDev[0].id
        Write-Host "✔ המחשב נרשם בהצלחה." -ForegroundColor Green
    }
} catch {
    Write-Host "שגיאה ברישום המחשב: $_" -ForegroundColor Red
    exit
}

# 3. שמירת נתונים בקובץ המקומי
$config.asset_tag = $assetTag
$config.cart_name = $cartName
$config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
Write-Host "✔ עודכן קובץ קונפיגורציה מקומי." -ForegroundColor Green


# 4. רישום ה-Service ב-Windows
Write-Host ""
Write-Host "מתקין שירות מערכת (CartAgent)..." -ForegroundColor Cyan
$nssmPath = Join-Path $PSScriptRoot "nssm.exe"
if (-not (Test-Path $nssmPath)) {
    $nssmPath = Join-Path $PSScriptRoot "dist\nssm.exe"
}

if (-not (Test-Path $nssmPath)) {
    Write-Host "מוריד כלי עזר (NSSM)..." -ForegroundColor Yellow
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
    Write-Host "שגיאה: קובץ cart_agent.exe לא נמצא. אנא ודא שהרצת את build.bat קודם!" -ForegroundColor Red
    exit
}

# עצירה והסרה של השירות אם כבר קיים
& $nssmPath stop $serviceName 2>$null
& $nssmPath remove $serviceName confirm 2>$null

# התקנה מחדש
& $nssmPath install $serviceName "`"$exePath`""
& $nssmPath set $serviceName DisplayName "Cart Agent - Lock Screen"
& $nssmPath set $serviceName Description "מערכת ניהול השאלת מחשבים - מסך נעילה"
& $nssmPath set $serviceName Start SERVICE_AUTO_START
& $nssmPath set $serviceName AppDirectory "`"$(Split-Path $exePath)`""

& $nssmPath start $serviceName

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "ההתקנה הסתיימה בהצלחה!" -ForegroundColor Green
Write-Host "השירות פועל כעת ברקע והמחשב מוגדר ומחובר." -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

Stop-Transcript
