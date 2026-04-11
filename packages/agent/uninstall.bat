@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "BASE_DIR=%~dp0"
set "REMOVE_SCRIPT=%BASE_DIR%remove-pulse-agent.ps1"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"
set "INSTALL_ROOT=%BASE_DIR%"

if exist "%REMOVE_SCRIPT%" (
    set "TEMP_REMOVE_SCRIPT=%TEMP%\clarix-remove-pulse-agent-%RANDOM%%RANDOM%.ps1"
    copy /Y "%REMOVE_SCRIPT%" "!TEMP_REMOVE_SCRIPT!" >nul 2>nul
    set "CLARIX_INSTALL_ROOT=%INSTALL_ROOT%"
    if exist "!TEMP_REMOVE_SCRIPT!" (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "!TEMP_REMOVE_SCRIPT!"
    ) else (
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REMOVE_SCRIPT%"
    )
    set "EXIT_CODE=!ERRORLEVEL!"
    set "CLARIX_INSTALL_ROOT="
    if exist "!TEMP_REMOVE_SCRIPT!" del /f /q "!TEMP_REMOVE_SCRIPT!" >nul 2>nul
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
    pause
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
