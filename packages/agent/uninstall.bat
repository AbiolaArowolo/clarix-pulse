@echo off
setlocal EnableExtensions

set "BASE_DIR=%~dp0"
set "REMOVE_SCRIPT=%BASE_DIR%remove-pulse-agent.ps1"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"

if exist "%REMOVE_SCRIPT%" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REMOVE_SCRIPT%"
    set "EXIT_CODE=%ERRORLEVEL%"

    echo.
    if "%EXIT_CODE%"=="0" (
        echo Pulse uninstall finished.
    ) else (
        echo Pulse uninstall finished with exit code %EXIT_CODE%.
    )
    pause
    exit /b %EXIT_CODE%
)

if not exist "%EXE_PATH%" (
    echo ERROR: clarix-agent.exe not found beside uninstall.bat
    pause
    exit /b 1
)

"%EXE_PATH%" --uninstall-service
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Pulse uninstall finished.
) else (
    echo Pulse uninstall failed with exit code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%
