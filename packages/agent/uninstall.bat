@echo off
setlocal EnableExtensions

set "BASE_DIR=%~dp0"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"

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
