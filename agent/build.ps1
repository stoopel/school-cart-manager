# build.ps1 - Enterprise compiler for CartAgent Suite
$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Green
Write-Host " Building CartAgent - Enterprise Suite" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""

# Ensure dependencies are installed
Write-Host "[*] Installing Python dependencies..." -ForegroundColor Cyan
python -m pip install -r requirements.txt
python -m pip install pyinstaller requests

# 1. Build cart_agent.exe
Write-Host ""
Write-Host "[*] 1/4 Compiling cart_agent.exe..." -ForegroundColor Cyan
python -m PyInstaller --clean --onefile --windowed --name cart_agent --collect-all charset_normalizer --add-data "config.json;." --add-data "interception.dll;." agent.py

# 2. Build cart_watchdog.exe
Write-Host ""
Write-Host "[*] 2/4 Compiling cart_watchdog.exe..." -ForegroundColor Cyan
python -m PyInstaller --clean --onefile --windowed --name cart_watchdog watchdog.py

# 3. Build uninstaller.exe
Write-Host ""
Write-Host "[*] 3/4 Compiling uninstaller.exe..." -ForegroundColor Cyan
python -m PyInstaller --clean --onefile --windowed --uac-admin --name uninstaller uninstaller.py

# 4. Build setup_agent.exe (Self-contained Enterprise Installer)
Write-Host ""
Write-Host "[*] 4/4 Compiling setup_agent.exe (Self-contained Installer)..." -ForegroundColor Cyan
python -m PyInstaller --clean --onefile --windowed --uac-admin --name setup_agent `
  --add-data "config.json;." `
  --add-data "interception.dll;." `
  --add-data "install-interception.exe;." `
  --add-data "dist\cart_agent.exe;." `
  --add-data "dist\cart_watchdog.exe;." `
  --add-data "dist\uninstaller.exe;." `
  installer.py

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host " Compilation completed successfully!" -ForegroundColor Green
Write-Host " Target files are available under: .\dist\" -ForegroundColor Green
Write-Host " The main distributable file is: dist\setup_agent.exe" -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Green
