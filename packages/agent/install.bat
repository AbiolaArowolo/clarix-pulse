@echo off
:: Clarix Pulse Agent — Windows Service Installer
:: Run this as Administrator on each playout PC
:: Edit config.yaml BEFORE running this script

setlocal
set AGENT_DIR=%~dp0
set SERVICE_NAME=ClarixPulseAgent
set EXE_PATH=%AGENT_DIR%clarix-agent.exe

echo.
echo === Clarix Pulse Agent Installer ===
echo Agent directory: %AGENT_DIR%
echo.

:: Check config.yaml exists
if not exist "%AGENT_DIR%config.yaml" (
    echo ERROR: config.yaml not found in %AGENT_DIR%
    echo Please copy config.example.yaml to config.yaml and fill in your settings.
    pause
    exit /b 1
)

:: Check NSSM exists
if not exist "%AGENT_DIR%nssm.exe" (
    echo ERROR: nssm.exe not found in %AGENT_DIR%
    pause
    exit /b 1
)

:: Remove existing service if present
"%AGENT_DIR%nssm.exe" status %SERVICE_NAME% >nul 2>&1
if %errorlevel% == 0 (
    echo Removing existing service...
    "%AGENT_DIR%nssm.exe" stop %SERVICE_NAME% >nul 2>&1
    "%AGENT_DIR%nssm.exe" remove %SERVICE_NAME% confirm >nul 2>&1
)

:: Install service
echo Installing Windows service: %SERVICE_NAME%
"%AGENT_DIR%nssm.exe" install %SERVICE_NAME% "%EXE_PATH%"
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppDirectory "%AGENT_DIR%"
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppRestartDelay 5000
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppStdout "%AGENT_DIR%clarix-agent.log"
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppStderr "%AGENT_DIR%clarix-agent.log"
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppRotateFiles 1
"%AGENT_DIR%nssm.exe" set %SERVICE_NAME% AppRotateBytes 10485760

:: Start service
echo Starting service...
"%AGENT_DIR%nssm.exe" start %SERVICE_NAME%

echo.
echo === Installation complete ===
echo Service "%SERVICE_NAME%" is now running and will auto-start on boot.
echo Log file: %AGENT_DIR%clarix-agent.log
echo.
echo To check status:  sc query %SERVICE_NAME%
echo To view logs:     type "%AGENT_DIR%clarix-agent.log"
echo To uninstall:     %AGENT_DIR%uninstall.bat
echo.
pause
