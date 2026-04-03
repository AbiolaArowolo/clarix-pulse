CLARIX PULSE - NODE INSTALLATION GUIDE
========================================

WHAT IS THIS?
  Clarix Pulse monitors your playout nodes and live streams, reporting health
  and alerts to your Clarix Pulse dashboard in real time.


BEFORE YOU START
  1. Create an account at  https://pulse.clarixtech.com
  2. Sign in and go to the Onboarding section
  3. Copy your enrollment key - you will need it during setup


STEP-BY-STEP INSTALLATION (most users)
  1. Copy this entire folder to the target Windows machine
  2. Double-click  setup.bat
  3. Choose  [1] Install Pulse as a Windows service
  4. Windows may ask for Administrator approval - click Yes
  5. The Clarix Pulse setup UI opens in your browser automatically
  6. Enter your enrollment key and follow the on-screen steps
  7. Pulse discovers your players and registers this node - done


OPTION: SCAN FIRST, CONFIGURE FROM DASHBOARD
  If you want to preview what Pulse will find before committing to an install:

  1. Double-click  setup.bat
  2. Choose  [3] Scan this computer for playout players
  3. A file called  pulse-node-discovery-report.json  is created in this folder
  4. Log in to  https://pulse.clarixtech.com
  5. Go to Onboarding > Remote Setup and upload the report
  6. Review the detected players on the dashboard and adjust settings
  7. Click Provision - the dashboard generates a ready-to-use config.yaml
  8. Download that config.yaml and place it in this folder (replacing the existing one)
  9. Run  setup.bat  again and choose  [1] Install


WHAT EACH FILE DOES
  setup.bat          Main entry point. Install, configure, scan, or uninstall.
  config.yaml        Node settings. Contains hub URL and enrollment/agent token.
  discover-node.ps1  Scans this PC for playout software and streams.
  clarix-agent.exe   The Clarix Pulse agent that runs as a Windows service.
  nssm.exe           Windows service manager used during install/uninstall.
  ffmpeg.exe         Stream probe tool used automatically for UDP monitoring.
  ffprobe.exe        Stream probe tool used automatically for UDP monitoring.


CHANGING SETTINGS AFTER INSTALL
  - Run  setup.bat  and choose  [2] Open configuration and setup UI
  - Or log in to the dashboard and use Remote Setup to push a new config


UNINSTALLING
  - Run  setup.bat  and choose  [4] Uninstall and remove Pulse service
  - Your config.yaml is kept so you can reinstall without re-entering settings


TROUBLESHOOTING
  - If install fails, right-click setup.bat and choose "Run as administrator"
  - If the browser does not open automatically, go to  http://localhost:9000
  - For further help, contact support or visit the dashboard


SUPPORT
  Dashboard : https://pulse.clarixtech.com
  Email     : support@clarixtech.com
