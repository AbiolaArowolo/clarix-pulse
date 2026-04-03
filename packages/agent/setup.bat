@echo off
setlocal EnableExtensions
title Clarix Pulse — Node Setup

set "BASE_DIR=%~dp0"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"

if not exist "%EXE_PATH%" (
    echo.
    echo ERROR: clarix-agent.exe not found in this folder.
    echo        Make sure setup.bat is in the same folder as clarix-agent.exe.
    pause
    exit /b 1
)

:MENU
cls
echo.
echo  =====================================================
echo    CLARIX PULSE  ^|  Node Setup
echo  =====================================================
echo.
echo    [1]  Install Pulse as a Windows service
echo    [2]  Open configuration and setup UI
echo    [3]  Scan this computer for playout players
echo    [4]  Uninstall and remove Pulse service
echo    [5]  Exit
echo.
set /p CHOICE=   Choose an option (1-5):

if "%CHOICE%"=="1" goto INSTALL
if "%CHOICE%"=="2" goto CONFIGURE
if "%CHOICE%"=="3" goto SCAN
if "%CHOICE%"=="4" goto UNINSTALL
if "%CHOICE%"=="5" exit /b 0
goto MENU

:INSTALL
echo.
echo  Installing Clarix Pulse service...
echo  You may be prompted for Administrator approval.
echo.
"%EXE_PATH%" --install-service
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" (
    echo.
    echo  Service installed successfully.
    echo  Opening setup UI in your browser...
    timeout /t 2 >nul
    "%EXE_PATH%" --open-local-ui
) else (
    echo.
    echo  Install failed with exit code %EC%.
    echo  Try running setup.bat as Administrator ^(right-click ^> Run as administrator^).
)
echo.
pause
goto MENU

:CONFIGURE
echo.
echo  Opening Clarix Pulse configuration UI...
echo.
"%EXE_PATH%" --open-local-ui
if "%ERRORLEVEL%"=="2" (
    echo  Fallback: running guided configuration...
    "%EXE_PATH%" --configure
)
echo.
pause
goto MENU

:SCAN
echo.
echo  Scanning this computer for playout players and services...
echo  Output: %BASE_DIR%pulse-node-discovery-report.json
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%BASE_DIR%discover-node.ps1"
echo.
echo  Scan complete.
echo  You can upload pulse-node-discovery-report.json to the
echo  Remote Setup tab on your Clarix Pulse dashboard.
echo.
pause
goto MENU

:UNINSTALL
echo.
echo  WARNING: This will stop and remove the Clarix Pulse Windows service.
echo  Your config.yaml file will not be deleted.
echo.
set /p CONFIRM=   Type YES to confirm uninstall:
if /i not "%CONFIRM%"=="YES" (
    echo  Cancelled.
    echo.
    pause
    goto MENU
)
echo.
"%EXE_PATH%" --uninstall-service
echo.
echo  Pulse service removed.
echo.
pause
goto MENU
