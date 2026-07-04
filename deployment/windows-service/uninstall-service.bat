@echo off
setlocal
set SERVICE_DIR=C:\Pinnacle\PosPrintAgent

echo ==============================================
echo  Pinnacle POS Print Agent - Uninstall Service
echo ==============================================
echo.

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
    echo Nothing to uninstall from this folder.
    echo.
    pause
    exit /b 1
)

cd /d "%SERVICE_DIR%"

echo Stopping service...
PosPrintAgentService.exe stop

echo Removing service...
PosPrintAgentService.exe uninstall

echo.
echo Service removed.
echo.
echo Local config and logs were NOT deleted:
echo   C:\ProgramData\Pinnacle\PosPrintAgent
echo Delete that folder yourself only if you intend to reset this counter's
echo printer configuration from scratch.
echo.
pause
