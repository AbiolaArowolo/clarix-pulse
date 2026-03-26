@echo off
:: Clarix Pulse Agent — Windows Service Uninstaller
:: Run as Administrator

set SERVICE_NAME=ClarixPulseAgent
set AGENT_DIR=%~dp0

echo Stopping and removing service: %SERVICE_NAME%
"%AGENT_DIR%nssm.exe" stop %SERVICE_NAME% >nul 2>&1
"%AGENT_DIR%nssm.exe" remove %SERVICE_NAME% confirm

echo Service removed.
pause
