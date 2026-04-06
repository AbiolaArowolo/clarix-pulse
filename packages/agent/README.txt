CLARIX PULSE - NODE INSTALLATION GUIDE
========================================

WHAT IS THIS?
  Clarix Pulse monitors your playout nodes and live streams, reporting health
  and alerts to your Clarix Pulse dashboard in real time.


BEFORE YOU START
  1. Create an account at  https://pulse.clarixtech.com
  2. Sign in - your account is ready to use immediately after registration


STEP-BY-STEP INSTALLATION
==========================

STEP 1 - Download and extract
  1. Sign in to  https://pulse.clarixtech.com
  2. Go to Account > Downloads and click  Download Clarix Pulse
  3. Save the .zip file to your Desktop
  4. Right-click the zip and choose  Extract All
  5. Extract to:  C:\ClarixPulse
  6. Open the extracted Clarix Pulse folder and confirm these files are there:
       setup.bat, configure.bat, install.bat, uninstall.bat,
       clarix-agent.exe, discover-node.ps1, show-discovery-summary.ps1,
       config.yaml, README.txt

STEP 2 - Scan and review temporary local setup
  1. Double-click  setup.bat
     - If Windows asks for permission, click Yes
  2. Press  2  then Enter:
       [2]  Run discovery scan and open local setup UI
  3. The scan runs automatically (under 60 seconds)
  4. The temporary local Pulse setup UI opens in your browser with this computer's
     details already filled in from the scan
  5. If your download included  pulse-account.json, the hub URL and
     enrollment key are filled in automatically
  6. Review the Node Name, Site ID, players, and paths
  7. Click  Save Local Settings
  8. During setup, the temporary UI uses the first free localhost port
     in this range:
       http://127.0.0.1:3211/ through http://127.0.0.1:3299/
     If it does not open automatically, use the exact localhost URL
     printed in the console window
  9. After Pulse is installed, the regular local UI stays at:
       http://127.0.0.1:3210/

STEP 3 - Install the agent
  1. Double-click  setup.bat
     - Click Yes if Windows asks for Administrator approval
  2. Press  1  then Enter:
       [1]  Install Pulse as a Windows service
  3. You will see  Service installed successfully  when done
  4. Press any key, then press 5 to close

The agent now runs in the background and starts automatically every time
this computer boots. You do not need to do anything else.

STEP 4 - Confirm it is working
  1. Sign in to  https://pulse.clarixtech.com
  2. Click  Dashboard
  3. Wait about 10 to 15 seconds - your node should appear with a green status

If the node shows green, installation is complete.


WHAT EACH FILE DOES
===================
  setup.bat          Main entry point. Scan, configure, install, or uninstall.
  config.yaml        Node settings. Contains hub URL and agent token.
  discover-node.ps1  Scans this PC for playout software automatically.
  show-discovery-summary.ps1  Prints the scan summary used by setup.bat.
  clarix-agent.exe   The Clarix Pulse agent that runs as a Windows service.
  nssm.exe           Windows service manager used during install/uninstall.
  ffmpeg.exe         Stream probe tool used for UDP stream monitoring.
  ffprobe.exe        Stream probe tool used for UDP stream monitoring.


TROUBLESHOOTING
===============

Nothing appears on the dashboard after 2 minutes:
  - Check this computer has an internet connection
  - Run setup.bat again and choose [1] to reinstall the service
  - Click Yes if Windows asks for Administrator approval
  - Wait about 15 seconds and refresh the dashboard

Browser opens but the form is empty:
  - Run setup.bat and choose [2] again
  - If the guided UI still does not appear, run configure.bat
  - Optional dashboard fallback:
      Run setup.bat > choose [3] to save the report file
      Go to dashboard > Onboarding > Remote Setup
      Click Upload discovery report and select:
        C:\ClarixPulse\pulse-node-discovery-report.json

PowerShell says scripts are disabled:
  - Right-click  discover-node.ps1  and choose Properties
  - Look for an Unblock checkbox at the bottom - tick it and click OK
  - Run setup.bat and choose [2] again

Wrong players detected:
  - In the local setup UI, edit the detected players before saving
  - Or use the dashboard fallback above if you prefer remote provisioning

Install fails even as Administrator:
  - Run setup.bat and choose [4] to fully uninstall first
  - Then run setup.bat and choose [1] to reinstall fresh

Changing settings after install:
  - Run setup.bat and choose [2] to open the configuration UI
  - Or sign in to the dashboard and use Remote Setup to push a new config

Uninstalling:
  - Run setup.bat and choose [4] Uninstall and remove Pulse service
  - Your config.yaml is kept so you can reinstall without losing settings


SUPPORT
=======
  Dashboard : https://pulse.clarixtech.com
  Email     : support@clarixtech.com
