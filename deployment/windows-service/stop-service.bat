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
    echo There is no installed service to stop from this folder.
    echo.
    pause
    exit /b 1
)

cd /d "%SERVICE_DIR%"

echo Stopping Pinnacle POS Print Agent service...
PosPrintAgentService.exe stop
if %errorlevel% neq 0 (
    echo.
    echo Service did not stop cleanly. Check services.msc for its current state.
) else (
    echo.
    echo Service stopped.
)
echo.
pause
