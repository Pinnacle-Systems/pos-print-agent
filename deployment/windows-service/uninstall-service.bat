@echo off
set SERVICE_DIR=C:\Pinnacle\PosPrintAgent

echo Stopping Pinnacle POS Print Agent service...

cd /d "%SERVICE_DIR%"

PosPrintAgentService.exe stop
PosPrintAgentService.exe uninstall

echo.
echo Service removed.
echo Local config was not deleted:
echo C:\ProgramData\Pinnacle\PosPrintAgent
echo.
pause
