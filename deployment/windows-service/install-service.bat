@echo off
setlocal
set SERVICE_DIR=C:\Pinnacle\PosPrintAgent

echo ============================================
echo  Pinnacle POS Print Agent - Install Service
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click this file and choose "Run as administrator", then try again.
    echo.
    pause
    exit /b 1
)

if not exist "%SERVICE_DIR%\PosPrintAgent.exe" (
    echo ERROR: PosPrintAgent.exe was not found in %SERVICE_DIR%
    echo Make sure this whole release folder was copied to %SERVICE_DIR%
    echo before installing the service.
    echo.
    pause
    exit /b 1
)

if not exist "%SERVICE_DIR%\PosPrintAgentService.exe" (
    echo ERROR: PosPrintAgentService.exe ^(WinSW^) was not found in %SERVICE_DIR%
    echo Download it from https://github.com/winsw/winsw/releases, rename it to
    echo PosPrintAgentService.exe, place it in this folder, and try again.
    echo.
    pause
    exit /b 1
)

echo Creating config/log/temp folders if missing...
if not exist "C:\ProgramData\Pinnacle\PosPrintAgent" mkdir "C:\ProgramData\Pinnacle\PosPrintAgent"
if not exist "C:\ProgramData\Pinnacle\PosPrintAgent\logs" mkdir "C:\ProgramData\Pinnacle\PosPrintAgent\logs"
if not exist "C:\ProgramData\Pinnacle\PosPrintAgent\temp" mkdir "C:\ProgramData\Pinnacle\PosPrintAgent\temp"

cd /d "%SERVICE_DIR%"

echo Installing service...
PosPrintAgentService.exe install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Service install failed. If the service is already installed,
    echo run uninstall-service.bat first, then try again.
    echo.
    pause
    exit /b 1
)

sc config PinnaclePosPrintAgent start= auto >nul

echo Starting service...
PosPrintAgentService.exe start
if %errorlevel% neq 0 (
    echo.
    echo WARNING: The service was installed but did not start. Check:
    echo   C:\ProgramData\Pinnacle\PosPrintAgent\logs\agent.log
    echo and the Windows Event Viewer ^(Application log^) for details.
    echo.
    pause
    exit /b 1
)

echo.
echo Service installed and started.
echo.
echo Health:  http://127.0.0.1:17777/health
echo Setup:   http://127.0.0.1:17777/setup
echo.
echo Next: open the Setup page above and configure the printers for this counter.
echo.
pause
