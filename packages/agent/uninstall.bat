@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BASE_DIR=%~dp0"
set "REMOVE_SCRIPT=%BASE_DIR%remove-pulse-agent.ps1"
set "PROGRAMDATA_SCRIPT=%PROGRAMDATA%\ClarixPulse\Agent\remove-pulse-agent.ps1"
set "LEGACY_SCRIPT=C:\ClarixPulse\remove-pulse-agent.ps1"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"
set "INSTALL_ROOT=%BASE_DIR%"
if "%INSTALL_ROOT:~-1%"=="\" set "INSTALL_ROOT=%INSTALL_ROOT:~0,-1%"

set "HELPER_SCRIPT="
if exist "%REMOVE_SCRIPT%" set "HELPER_SCRIPT=%REMOVE_SCRIPT%"
if not defined HELPER_SCRIPT if exist "%PROGRAMDATA_SCRIPT%" set "HELPER_SCRIPT=%PROGRAMDATA_SCRIPT%"
if not defined HELPER_SCRIPT if exist "%LEGACY_SCRIPT%" set "HELPER_SCRIPT=%LEGACY_SCRIPT%"

if defined HELPER_SCRIPT (
    set "TEMP_SCRIPT=%TEMP%\clarix-pulse-uninstall-%RANDOM%%RANDOM%.ps1"
    copy /Y "%HELPER_SCRIPT%" "%TEMP_SCRIPT%" >nul
    if errorlevel 1 (
        echo ERROR: Could not stage uninstall helper script.
        exit /b 1
    )

    set "CLARIX_INSTALL_ROOT=%INSTALL_ROOT%"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TEMP_SCRIPT%" -InstallRoot "%INSTALL_ROOT%"
    set "EXIT_CODE=!ERRORLEVEL!"
    del /f /q "%TEMP_SCRIPT%" >nul 2>&1
    set "CLARIX_INSTALL_ROOT="
    if not defined EXIT_CODE set "EXIT_CODE=1"

    echo.
    if "!EXIT_CODE!"=="0" (
        echo Pulse uninstall finished.
    ) else (
        echo Pulse uninstall finished with exit code !EXIT_CODE!.
    )
    exit /b !EXIT_CODE!
)

if not exist "%EXE_PATH%" (
    echo ERROR: clarix-agent.exe not found beside uninstall.bat
    exit /b 1
)

"%EXE_PATH%" --uninstall-service
set "EXIT_CODE=!ERRORLEVEL!"
if not defined EXIT_CODE set "EXIT_CODE=1"

echo.
if "!EXIT_CODE!"=="0" (
    echo Pulse uninstall finished.
) else (
    echo Pulse uninstall failed with exit code !EXIT_CODE!.
)
exit /b !EXIT_CODE!
