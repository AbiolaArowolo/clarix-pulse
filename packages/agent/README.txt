CLARIX PULSE - QUICK INSTALL
============================

FILES IN THIS DOWNLOAD
  1. ClarixPulseSetup.exe
  2. README.txt
  3. Uninstall.exe
  4. pulse-account.json (downloaded from the Hub per account)


INSTALL (WINDOWS)
=================
  1. Double-click ClarixPulseSetup.exe
  2. Windows may ask for permission. Click Run / Yes.
  3. The installer copies files to:
       C:\ClarixPulse
     If this account cannot write to C:\, it uses:
       %LOCALAPPDATA%\ClarixPulse
  4. Setup menu opens automatically.
  5. In setup menu:
       - Choose [2] to scan this PC and review detected players
       - Save local settings
       - Choose [1] to install the Pulse service


AFTER INSTALL
=============
  - Local UI:
      http://127.0.0.1:3210/
  - Temporary setup UI (during guided setup only):
      http://127.0.0.1:3211/ to http://127.0.0.1:3299/
  - Installed files:
      C:\ClarixPulse  or  %LOCALAPPDATA%\ClarixPulse


UNINSTALL
=========
  - Double-click Uninstall.exe
  - Or run:
      C:\ClarixPulse\uninstall.bat


TROUBLESHOOTING
===============
  - If setup does not open:
      Open C:\ClarixPulse and run setup.bat manually.
  - If uninstall is blocked:
      Open PowerShell as Administrator and run:
      powershell -ExecutionPolicy Bypass -NoProfile -File C:\ClarixPulse\remove-pulse-agent.ps1


SUPPORT
=======
  Email: support@clarixtech.com
