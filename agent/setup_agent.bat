@echo off
chcp 65001 > nul
echo ===========================================
echo  School Laptop Cart Manager - Agent Setup
echo ===========================================

net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Administrator privileges required! Requesting permissions...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Starting smart installation script...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_logic.ps1"
pause
