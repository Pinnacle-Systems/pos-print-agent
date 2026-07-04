@echo off
setlocal
set SERVICE_DIR=C:\Pinnacle\PosPrintAgent

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click this file and choose "Run as administrator", then try again.
    echo.
    pause
    exit /b 1
)

if not exist "%SERVICE_DIR%\PosPrintAgentService.exe" (
    echo ERROR: PosPrintAgentService.exe was not found in %SERVICE_DIR%
    echo Run install-service.bat first.
    echo.
    pause
    exit /b 1
)

cd /d "%SERVICE_DIR%"

echo Starting Pinnacle POS Print Agent service...
PosPrintAgentService.exe start
if %errorlevel% neq 0 (
    echo.
    echo Service did not start. Check:
    echo   C:\ProgramData\Pinnacle\PosPrintAgent\logs\agent.log
    echo and the Windows Event Viewer ^(Application log^) for details.
) else (
    echo.
    echo Service started. Health: http://127.0.0.1:17777/health
)
echo.
pause
