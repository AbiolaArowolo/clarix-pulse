@echo off
setlocal EnableExtensions
title Clarix Pulse ^| Node Setup

set "BASE_DIR=%~dp0"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"
set "REPORT_PATH=%TEMP%\pulse-node-discovery-report.json"
set "PS_EXE="
set "BUNDLE_VERSION="

where pwsh.exe >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh.exe"
if not defined PS_EXE (
    where powershell.exe >nul 2>nul
    if not errorlevel 1 set "PS_EXE=powershell.exe"
)
if not defined PS_EXE set "PS_EXE=powershell"

if not exist "%EXE_PATH%" (
    echo.
    echo ERROR: clarix-agent.exe not found in this folder.
    echo        Make sure setup.bat is in the same folder as clarix-agent.exe.
    pause
    exit /b 1
)

call :DETECT_VERSION

:MENU
cls
echo.
echo  =====================================================
echo    CLARIX PULSE  ^|  Node Setup  ^|  %BUNDLE_VERSION%
echo  =====================================================
echo.
echo    [1]  Install Pulse as a Windows service
echo    [2]  Scan this computer and open local setup UI
echo    [3]  Uninstall and remove Pulse service
echo    [4]  Exit
echo.
set /p CHOICE=   Choose an option (1-4):

if "%CHOICE%"=="1" goto INSTALL
if "%CHOICE%"=="2" goto CONFIGURE
if "%CHOICE%"=="3" goto UNINSTALL
if "%CHOICE%"=="4" exit /b 0
goto MENU

:DETECT_VERSION
if not defined BUNDLE_VERSION for %%I in ("%BASE_DIR:~0,-1%") do set "BUNDLE_VERSION=%%~nxI"
if /i "%BUNDLE_VERSION:~0,13%"=="clarix-pulse-" set "BUNDLE_VERSION=%BUNDLE_VERSION:~13%"
if not defined BUNDLE_VERSION set "BUNDLE_VERSION=local"
exit /b 0

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
    echo.
    echo  Opening local Pulse UI in your browser...
    call :OPEN_LOCAL_UI
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
call :RUN_SCAN
if errorlevel 1 (
    echo.
    echo  Discovery scan failed. The temporary setup UI was not opened.
    echo  Review the messages above, then choose option [2] again.
    echo.
    pause
    goto MENU
)
call :SHOW_SUMMARY
echo.
echo  Opening local setup UI with the scan details pre-loaded...
echo  Temporary setup URL will use the first free localhost port from 3211-3299.
echo  If it does not open automatically, use the exact localhost URL printed below.
call :OPEN_LOCAL_SETUP
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

:RUN_SCAN
echo  Running discovery scan (this may take 30-90 seconds on busy PCs)...
echo  Discovery progress will appear below while Pulse checks config, processes, services, registry, and logs.
del /f /q "%REPORT_PATH%" 2>nul
"%PS_EXE%" -ExecutionPolicy Bypass -NoProfile -File "%BASE_DIR%discover-node.ps1" -OutputPath "%REPORT_PATH%"
set "SCAN_EC=%ERRORLEVEL%"
if not "%SCAN_EC%"=="0" (
    echo   Scan failed with exit code %SCAN_EC%.
    if exist "%REPORT_PATH%" (
        echo   A partial report was found at %REPORT_PATH%, but setup will not continue automatically.
    )
    exit /b %SCAN_EC%
)
if exist "%REPORT_PATH%" (
    echo   Scan complete.
) else (
    echo   WARNING: Scan did not produce a report.
    exit /b 1
)
exit /b 0

:OPEN_LOCAL_SETUP
if exist "%REPORT_PATH%" (
    "%EXE_PATH%" --configure-bundle "%REPORT_PATH%"
) else (
    "%EXE_PATH%" --configure-bundle
)
exit /b 0

:OPEN_LOCAL_UI
timeout /t 3 >nul
"%EXE_PATH%" --open-local-ui
if "%ERRORLEVEL%"=="2" (
    echo  Persistent local UI is not running yet.
    echo  Use option [2] ^(Scan + setup^) to run guided configuration.
)
exit /b 0

:SHOW_SUMMARY
"%PS_EXE%" -ExecutionPolicy Bypass -NoProfile -File "%BASE_DIR%show-discovery-summary.ps1" -ReportPath "%REPORT_PATH%"
exit /b 0
