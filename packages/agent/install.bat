@echo off
:: Pulse Agent - One-click Windows Service Installer
:: Run this as Administrator from a prepared node bundle.

setlocal EnableExtensions EnableDelayedExpansion

set "SOURCE_DIR=%~dp0"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"

set "INSTALL_DIR=%ProgramData%\ClarixPulse\Agent"
set "SERVICE_NAME=ClarixPulseAgent"
set "DISPLAY_NAME=Pulse Agent"
set "BUNDLE_NSSM_PATH=%SOURCE_DIR%\nssm.exe"
set "EXE_PATH=%INSTALL_DIR%\clarix-agent.exe"
set "CONFIG_PATH=%INSTALL_DIR%\config.yaml"
set "CONFIG_EXAMPLE_PATH=%INSTALL_DIR%\config.example.yaml"
set "LOG_PATH=%INSTALL_DIR%\clarix-agent.log"
set "NSSM_PATH=%INSTALL_DIR%\nssm.exe"
set "FFMPEG_PATH=%INSTALL_DIR%\ffmpeg.exe"
set "FFPROBE_PATH=%INSTALL_DIR%\ffprobe.exe"

call :require_admin || goto :fail
call :banner
call :validate_bundle || goto :fail
call :stop_existing_service || goto :fail
call :stage_bundle || goto :fail
call :ensure_config || goto :fail
call :validate_udp_tools || goto :fail
call :install_service || goto :fail
call :start_service || goto :fail
call :success
exit /b 0

:banner
echo.
echo === Pulse Node Installer ===
echo Source bundle: %SOURCE_DIR%
echo Install path:  %INSTALL_DIR%
echo.
echo The agent can point at a local LAN hub or a remote hub.
echo Internet is only required when the configured hub is remote or when
echo Telegram/email alerts must leave the local network.
echo.
exit /b 0

:require_admin
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo ERROR: Administrator privileges are required.
    echo Right-click install.bat and choose "Run as administrator".
    exit /b 1
)
exit /b 0

:validate_bundle
if not exist "%SOURCE_DIR%\clarix-agent.exe" (
    echo ERROR: clarix-agent.exe not found in the bundle folder.
    exit /b 1
)
if not exist "%SOURCE_DIR%\config.example.yaml" (
    echo ERROR: config.example.yaml not found in the bundle folder.
    exit /b 1
)
if not exist "%SOURCE_DIR%\nssm.exe" (
    echo ERROR: nssm.exe not found in the bundle folder.
    echo Build the node bundle with the required vendor files first.
    exit /b 1
)
exit /b 0

:stop_existing_service
sc query %SERVICE_NAME% >nul 2>&1
if not "%errorlevel%"=="0" exit /b 0

echo Stopping existing service before updating files...
"%BUNDLE_NSSM_PATH%" stop %SERVICE_NAME% >nul 2>&1
"%BUNDLE_NSSM_PATH%" remove %SERVICE_NAME% confirm >nul 2>&1
taskkill /IM clarix-agent.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
exit /b 0

:stage_bundle
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" >nul 2>&1
)
if not exist "%INSTALL_DIR%" (
    echo ERROR: Failed to create %INSTALL_DIR%
    exit /b 1
)

echo Copying bundle files into %INSTALL_DIR% ...
copy /Y "%SOURCE_DIR%\clarix-agent.exe" "%INSTALL_DIR%\" >nul || exit /b 1
copy /Y "%SOURCE_DIR%\config.example.yaml" "%INSTALL_DIR%\" >nul || exit /b 1
copy /Y "%SOURCE_DIR%\install.bat" "%INSTALL_DIR%\" >nul || exit /b 1
copy /Y "%SOURCE_DIR%\uninstall.bat" "%INSTALL_DIR%\" >nul || exit /b 1
if exist "%SOURCE_DIR%\configure.bat" (
    copy /Y "%SOURCE_DIR%\configure.bat" "%INSTALL_DIR%\" >nul || exit /b 1
)
copy /Y "%SOURCE_DIR%\nssm.exe" "%INSTALL_DIR%\" >nul || exit /b 1

if exist "%SOURCE_DIR%\ffmpeg.exe" (
    copy /Y "%SOURCE_DIR%\ffmpeg.exe" "%INSTALL_DIR%\" >nul || exit /b 1
)
if exist "%SOURCE_DIR%\ffprobe.exe" (
    copy /Y "%SOURCE_DIR%\ffprobe.exe" "%INSTALL_DIR%\" >nul || exit /b 1
)

if exist "%SOURCE_DIR%\config.yaml" (
    if not exist "%CONFIG_PATH%" (
        echo Using bundle-provided config.yaml
        copy /Y "%SOURCE_DIR%\config.yaml" "%CONFIG_PATH%" >nul || exit /b 1
    )
)
if not exist "%CONFIG_PATH%" (
    echo Creating config.yaml from config.example.yaml
    copy /Y "%CONFIG_EXAMPLE_PATH%" "%CONFIG_PATH%" >nul || exit /b 1
)
exit /b 0

:ensure_config
set "FIRST_RUN=0"
findstr /I /C:"REPLACE_ME" "%CONFIG_PATH%" >nul 2>&1
if "%errorlevel%"=="0" set "FIRST_RUN=1"

if "%FIRST_RUN%"=="1" (
    echo.
    echo Opening config.yaml for first-time setup...
    echo Set node_id, hub_url, agent_token, player paths, and UDP inputs as needed.
    echo Save the file and close Notepad to continue.
    echo.
    notepad "%CONFIG_PATH%"
)

call :validate_config_field "node_id"
if not "%errorlevel%"=="0" exit /b 1
call :validate_config_field "hub_url"
if not "%errorlevel%"=="0" exit /b 1
call :validate_config_field "agent_token"
if not "%errorlevel%"=="0" exit /b 1
findstr /R /C:"^[ ]*-[ ]*player_id:[ ]*.*" "%CONFIG_PATH%" >nul 2>&1
if not "%errorlevel%"=="0" (
    echo ERROR: config.yaml must define at least one player_id entry.
    exit /b 1
)
findstr /I /C:"REPLACE_ME" "%CONFIG_PATH%" >nul 2>&1
if "%errorlevel%"=="0" (
    echo ERROR: config.yaml still contains REPLACE_ME placeholders.
    exit /b 1
)
exit /b 0

:validate_config_field
set "FIELD_NAME=%~1"
findstr /R /C:"^[ ]*!FIELD_NAME!:[ ]*.*" "%CONFIG_PATH%" >nul 2>&1
if "%errorlevel%"=="0" exit /b 0
echo ERROR: config.yaml is missing a value for !FIELD_NAME!.
exit /b 1

:validate_udp_tools
findstr /R /I /C:"^[ ]*enabled:[ ]*true[ ]*$" "%CONFIG_PATH%" >nul 2>&1
if not "%errorlevel%"=="0" exit /b 0

if not exist "%FFMPEG_PATH%" (
    echo ERROR: ffmpeg.exe is required because at least one UDP input is enabled.
    exit /b 1
)
if not exist "%FFPROBE_PATH%" (
    echo ERROR: ffprobe.exe is required because at least one UDP input is enabled.
    exit /b 1
)
exit /b 0

:install_service
echo.
echo Installing Windows service: %SERVICE_NAME%

"%NSSM_PATH%" install %SERVICE_NAME% "%EXE_PATH%" || exit /b 1
"%NSSM_PATH%" set %SERVICE_NAME% DisplayName "%DISPLAY_NAME%" >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppDirectory "%INSTALL_DIR%" >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% Start SERVICE_AUTO_START >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppRestartDelay 5000 >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppStdout "%LOG_PATH%" >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppStderr "%LOG_PATH%" >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppRotateFiles 1 >nul 2>&1
"%NSSM_PATH%" set %SERVICE_NAME% AppRotateBytes 10485760 >nul 2>&1
sc description %SERVICE_NAME% "Pulse local node monitoring agent" >nul 2>&1
exit /b 0

:start_service
echo Starting service...
"%NSSM_PATH%" start %SERVICE_NAME% || exit /b 1
exit /b 0

:success
echo.
echo === Installation complete ===
echo Service "%SERVICE_NAME%" is installed from:
echo   %INSTALL_DIR%
echo.
echo Log file:
echo   %LOG_PATH%
echo.
echo To edit the node config later:
echo   %INSTALL_DIR%\configure.bat
echo.
echo To check service status:
echo   sc query %SERVICE_NAME%
echo.
echo To uninstall:
echo   %INSTALL_DIR%\uninstall.bat
echo.
pause
exit /b 0

:fail
echo.
echo Installation did not complete.
echo Review the message above, update the bundle or config, and run install.bat again.
echo.
pause
exit /b 1
