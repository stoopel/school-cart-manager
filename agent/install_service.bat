@echo off
chcp 65001 > nul
echo ===================================
echo  התקנת cart_agent כשירות Windows
echo ===================================

:: בדוק הרשאות אדמין
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo נדרשות הרשאות אדמין. הרץ כ-Administrator.
    pause
    exit /b 1
)

:: נתיב ל-NSSM
set NSSM=nssm.exe
set SERVICE_NAME=CartAgent
set EXE_PATH=%~dp0dist\cart_agent.exe

:: הורד NSSM אם לא קיים
if not exist %NSSM% (
    echo מוריד NSSM...
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile nssm.zip; Expand-Archive nssm.zip -Force; copy nssm-2.24\win64\nssm.exe ."
)

:: הסר שירות קיים אם יש
%NSSM% stop %SERVICE_NAME% 2>nul
%NSSM% remove %SERVICE_NAME% confirm 2>nul

:: התקן שירות חדש
%NSSM% install %SERVICE_NAME% "%EXE_PATH%"
%NSSM% set %SERVICE_NAME% DisplayName "Cart Agent - Lock Screen"
%NSSM% set %SERVICE_NAME% Description "מערכת ניהול השאלת מחשבים - מסך נעילה"
%NSSM% set %SERVICE_NAME% Start SERVICE_AUTO_START
%NSSM% set %SERVICE_NAME% AppDirectory "%~dp0dist"

:: הפעל את השירות
%NSSM% start %SERVICE_NAME%

echo.
echo השירות CartAgent הותקן והופעל בהצלחה!
echo המסך ינעל אוטומטית עם כל הפעלה.
pause
