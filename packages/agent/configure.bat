@echo off
setlocal EnableExtensions

set "BASE_DIR=%~dp0"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"

if not exist "%EXE_PATH%" (
    echo ERROR: clarix-agent.exe not found beside configure.bat
    pause
    exit /b 1
)

"%EXE_PATH%" --configure
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Pulse configuration finished.
) else (
    echo Pulse configuration failed with exit code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%
