@echo off
setlocal EnableExtensions
title Clarix Pulse | Node Setup

set "BASE_DIR=%~dp0"
set "EXE_PATH=%BASE_DIR%clarix-agent.exe"
set "REPORT_PATH=%BASE_DIR%pulse-node-discovery-report.json"
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
echo    [2]  Run discovery scan and open local setup UI
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

:DETECT_VERSION
if not defined BUNDLE_VERSION (
    for %%I in ("%BASE_DIR:~0,-1%") do set "BUNDLE_VERSION=%%~nxI"
    if /i "%BUNDLE_VERSION:~0,13%"=="clarix-pulse-" set "BUNDLE_VERSION=%BUNDLE_VERSION:~13%"
)

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
call :SHOW_SUMMARY
echo.
echo  Opening local setup UI with the scan details pre-loaded...
echo  Temporary setup URL will use the first free localhost port from 3211-3299.
echo  If it does not open automatically, use the exact localhost URL printed below.
call :OPEN_LOCAL_SETUP
echo.
pause
goto MENU

:SCAN
echo.
echo  Scanning this computer for playout players and services...
echo  Output: %REPORT_PATH%
echo.
call :RUN_SCAN
call :SHOW_SUMMARY
echo.
echo  You can auto-load pulse-node-discovery-report.json into the
echo  local Pulse setup UI with option [2],
echo  OR upload it to the Remote Setup tab on your dashboard manually.
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
echo  Running discovery scan (this may take 30-60 seconds)...
del /f /q "%REPORT_PATH%" 2>nul
"%PS_EXE%" -ExecutionPolicy Bypass -NoProfile -File "%BASE_DIR%discover-node.ps1" -OutputPath "%REPORT_PATH%"
if exist "%REPORT_PATH%" (
    echo   Scan complete.
) else (
    echo   WARNING: Scan did not produce a report.
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
    echo  Run configure.bat if you need the guided setup flow.
)
exit /b 0

:SHOW_SUMMARY
set "PULSE_REPORT_PATH=%REPORT_PATH%"
"%PS_EXE%" -ExecutionPolicy Bypass -NoProfile -Command ^
    "$rp = $env:PULSE_REPORT_PATH; ^
     if (-not (Test-Path $rp)) { Write-Host '  (No scan report found)'; exit }; ^
     try { ^
       $raw = [System.IO.File]::ReadAllText($rp, (New-Object System.Text.UTF8Encoding $false)); ^
       $raw = $raw.TrimStart([char]0xFEFF); ^
       $r   = $raw | ConvertFrom-Json; ^
       Write-Host ''; ^
       Write-Host '  -------------------------------------------------'; ^
       Write-Host ('  Computer : ' + $r.node_name); ^
       Write-Host ('  Node ID  : ' + $r.node_id); ^
       Write-Host ('  Hub URL  : ' + $(if ($r.hub_url) { $r.hub_url } else { '(none found)' })); ^
       $pl = @($r.players); ^
       Write-Host ('  Players  : ' + $pl.Count + ' detected'); ^
       Write-Host '  -------------------------------------------------'; ^
       if ($pl.Count -gt 0) { ^
         Write-Host ''; ^
         Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f '#', 'Type', 'State', 'Label'); ^
         Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f '----', '--------------------', '------', '-----'); ^
         for ($i = 0; $i -lt $pl.Count; $i++) { ^
           $p     = $pl[$i]; ^
           $lbl   = if ($p.label)   { $p.label }   else { $p.player_id }; ^
           $state = if ($p.running -eq $true) { 'ON' } elseif ($p.installed -eq $true) { 'idle' } else { 'found' }; ^
           Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f ($i+1), $p.playout_type, $state, $lbl) ^
         } ^
       } else { ^
         Write-Host '  No broadcast software detected automatically.'; ^
         Write-Host '  You can add players manually in the local setup UI.' ^
       }; ^
       Write-Host '  -------------------------------------------------'; ^
       Write-Host '' ^
     } catch { Write-Host '  (Could not read scan report)' }"
set "PULSE_REPORT_PATH="
exit /b 0
