@echo off
:: Pulse Agent - Windows Service Uninstaller

setlocal EnableExtensions

set "SERVICE_NAME=ClarixPulseAgent"
set "INSTALL_DIR=%ProgramData%\ClarixPulse\Agent"
set "NSSM_PATH=%INSTALL_DIR%\nssm.exe"
if exist "%~dp0nssm.exe" set "NSSM_PATH=%~dp0nssm.exe"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo ERROR: Administrator privileges are required.
    pause
    exit /b 1
)

set "SERVICE_EXISTS=0"
sc query %SERVICE_NAME% >nul 2>&1
if "%errorlevel%"=="0" set "SERVICE_EXISTS=1"

echo Stopping and removing service: %SERVICE_NAME%
if "%SERVICE_EXISTS%"=="1" (
    if exist "%NSSM_PATH%" (
        "%NSSM_PATH%" stop %SERVICE_NAME% >nul 2>&1
        "%NSSM_PATH%" remove %SERVICE_NAME% confirm >nul 2>&1
    ) else (
        sc stop %SERVICE_NAME% >nul 2>&1
        sc delete %SERVICE_NAME% >nul 2>&1
    )
) else (
    echo Service not currently installed.
)

choice /M "Delete installed files from %INSTALL_DIR% too"
if errorlevel 2 goto :done
if exist "%INSTALL_DIR%" (
    rmdir /S /Q "%INSTALL_DIR%"
)

:done
echo Service removed.
pause
