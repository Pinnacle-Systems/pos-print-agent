@echo off
set SERVICE_DIR=C:\Pinnacle\PosPrintAgent

echo Installing Pinnacle POS Print Agent service...

if not exist "C:\ProgramData\Pinnacle\PosPrintAgent" (
    mkdir "C:\ProgramData\Pinnacle\PosPrintAgent"
)

if not exist "C:\ProgramData\Pinnacle\PosPrintAgent\logs" (
    mkdir "C:\ProgramData\Pinnacle\PosPrintAgent\logs"
)

cd /d "%SERVICE_DIR%"

PosPrintAgentService.exe install

sc config PinnaclePosPrintAgent start= auto

PosPrintAgentService.exe start

echo.
echo Service installed and started.
echo.
echo Health:
echo http://127.0.0.1:17777/health
echo.
echo Setup:
echo http://127.0.0.1:17777/setup
echo.
pause
