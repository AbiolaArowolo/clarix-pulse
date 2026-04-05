# Clarix Pulse - Installation Guide

**For broadcast operators installing Pulse on a playout workstation.**

This guide assumes you have already created your account at
[pulse.clarixtech.com](https://pulse.clarixtech.com) and are signed in.

Work through every step in order. Do not skip any step.

---

## What you will need

- A Windows computer (the playout workstation you want to monitor)
- Your Clarix Pulse account login
- The Clarix Pulse package downloaded from your Account page (a `.zip` file)
- An internet connection on that computer

---

## Step 1 - Download your Clarix Pulse package

1. Sign in to [pulse.clarixtech.com](https://pulse.clarixtech.com).
2. Click your account name (top-right corner) and choose **Account**.
3. Find the **Downloads** section and click **Download Clarix Pulse**.
4. Save the `.zip` file to your Desktop or Downloads folder.

> **Important:** Your zip file contains an access key linked to your account.
> Do not share this zip file with anyone outside your organization.

---

## Step 2 - Extract the package to a folder

1. Locate the `.zip` file you just downloaded.
2. Right-click it and choose **Extract All...**.
3. When asked where to extract, type:
   ```
   C:\ClarixPulse
   ```
4. Click **Extract**.
5. Open the folder `C:\ClarixPulse\clarix-pulse-v1.17`. You should see these files inside:
   - `setup.bat`
   - `clarix-agent.exe`
   - `discover-node.ps1`
   - `config.yaml`
   - `nssm.exe`
   - `ffmpeg.exe`
   - `ffprobe.exe`

If you see these files, you are ready for the next step.

---

## Step 3 - Scan and configure via setup.bat

This step scans your computer for playout software and opens the local Pulse
setup UI with the detected details pre-filled.

1. Open `C:\ClarixPulse\clarix-pulse-v1.17`.
2. Double-click `setup.bat`.
   - If Windows asks "Do you want to allow this app to make changes?", click **Yes**.
3. A menu appears with numbered options. Press **2** and then **Enter**:
   ```
   [2]  Run discovery scan and open local setup UI
   ```
4. The scan runs automatically (usually under 60 seconds).
5. Your default browser opens the local Pulse setup UI.
6. The local UI is already filled in with this computer's details
   (node name, detected players, paths, and any key details found from the
   downloaded bundle).
7. Review the detected values and click **Save Local Settings**.

> **Note:** If the browser does not open automatically, run `configure.bat`.
> If you prefer the remote dashboard flow, you can still run the scan manually
> (option 3 in the menu) and upload the `pulse-node-discovery-report.json`
> file from `C:\ClarixPulse` via the Remote Setup tab.

---

## Step 4 - Install the monitoring agent

1. Double-click `setup.bat`.
   - If Windows asks for Administrator approval, click **Yes**.
2. Press **1** then **Enter**:
   ```
   [1]  Install Pulse as a Windows service
   ```
3. The agent installs and starts the Pulse Windows service.
4. Press any key, then press **5** and **Enter** to close the menu.

The Clarix Pulse agent is now running in the background. It starts automatically
every time this computer boots - you do not need to do anything else.

---

## Step 5 - Confirm the node is live

1. Sign in to [pulse.clarixtech.com](https://pulse.clarixtech.com).
2. Click **Dashboard** in the left-hand menu.
3. Wait about 10 to 15 seconds. Your node should appear with a **green** status
   indicator.

**If the node shows green, installation is complete.**

---

## Troubleshooting

### Nothing appears on the dashboard after 2 minutes

- Check that this computer has a working internet connection.
- Open `C:\ClarixPulse\clarix-pulse-v1.17` and double-click `setup.bat`.
- Choose **1** to re-run the install. If prompted for Administrator approval,
  click Yes.
- Wait about 15 seconds, then refresh your dashboard.

### PowerShell says "cannot be loaded because running scripts is disabled"

This is a Windows security setting that blocked the scan script.

1. Open `C:\ClarixPulse`.
2. Right-click `discover-node.ps1` and choose **Properties**.
3. At the bottom of the Properties window, look for a checkbox or button
   labelled **Unblock**. Tick it (or click it) and then click **OK**.
4. Return to Step 3 and run again.

### The browser opened but the form is empty

Run option 2 from `setup.bat` again. That should re-open the local setup UI
with the latest scan results.

Alternatively, use the manual fallback:

1. In setup.bat, choose option **3** (Scan this computer) to save the report file.
2. In your dashboard, go to **Onboarding > Remote Setup**.
3. Click **Upload discovery report** and select
   `C:\ClarixPulse\clarix-pulse-v1.17\pulse-node-discovery-report.json`.

### The wrong players were detected

The dashboard lets you add or edit players manually:

1. In the local setup UI, edit the detected player list before saving.
2. If you prefer the remote provisioning flow, use the manual fallback above.

### Need more help?

- Dashboard: [pulse.clarixtech.com](https://pulse.clarixtech.com)
- Email: support@clarixtech.com
