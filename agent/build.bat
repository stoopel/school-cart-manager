@echo off
chcp 65001 > nul
echo ===========================
echo  בניית cart_agent.exe
echo ===========================

pip install -r requirements.txt
pip install pyinstaller

pyinstaller ^
  --onefile ^
  --windowed ^
  --name cart_agent ^
  --collect-all charset_normalizer ^
  --add-data "config.json;." ^
  agent.py

echo.
echo הקובץ cart_agent.exe נוצר בתיקיית dist\
pause
