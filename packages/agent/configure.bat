@echo off
:: Pulse Agent - Configuration Helper

setlocal EnableExtensions

set "SERVICE_NAME=ClarixPulseAgent"
set "INSTALL_DIR=%ProgramData%\ClarixPulse\Agent"
set "CONFIG_PATH=%INSTALL_DIR%\config.yaml"
set "CONFIG_EXAMPLE_PATH=%INSTALL_DIR%\config.example.yaml"
set "NSSM_PATH=%INSTALL_DIR%\nssm.exe"

if not exist "%INSTALL_DIR%" (
    echo ERROR: %INSTALL_DIR% does not exist.
    echo Run install.bat first.
    pause
    exit /b 1
)

if not exist "%CONFIG_PATH%" (
    if exist "%CONFIG_EXAMPLE_PATH%" (
        copy /Y "%CONFIG_EXAMPLE_PATH%" "%CONFIG_PATH%" >nul
    ) else (
        echo ERROR: config.example.yaml not found in %INSTALL_DIR%
        pause
        exit /b 1
    )
)

echo Opening %CONFIG_PATH%
echo.
echo You can enable or disable UDP per player by editing udp_inputs.
echo hub_url can point to a local LAN hub or a remote hub.
echo.
notepad "%CONFIG_PATH%"

sc query %SERVICE_NAME% >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Service is not installed yet, so there is nothing to restart.
    pause
    exit /b 0
)

if not exist "%NSSM_PATH%" (
    echo NSSM not found, so the service could not be restarted automatically.
    pause
    exit /b 0
)

choice /M "Restart %SERVICE_NAME% now to apply the new config"
if errorlevel 2 goto :done

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo WARNING: Restart skipped because Administrator privileges are required.
    echo Re-run this script as Administrator or restart the service manually.
    pause
    exit /b 0
)

"%NSSM_PATH%" restart %SERVICE_NAME%

:done
pause
