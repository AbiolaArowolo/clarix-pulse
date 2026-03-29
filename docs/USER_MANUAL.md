# Clarix Pulse - User Manual

**Document Date**: `2026-03-29 -04:00`

## Purpose

This is the detailed operator manual for Clarix Pulse.

It explains the normal user journey across:

- the public hub pages
- the signed-in dashboard
- remote node provisioning
- the Windows node local UI
- the optional install handoff page
- the main platform-admin controls

This manual is based on the current repo UI and flow. It is written for real operators, not developers.

---

## Quick Mental Model

Clarix Pulse works in two places at the same time:

1. the hub dashboard in the browser
2. the local setup UI on the Windows node

The normal pattern is:

1. create or sign into a workspace
2. download the installer
3. run discovery on the Windows node
4. upload the discovery report in `Remote Setup`
5. provision the node and download or pull the final `config.yaml`
6. save the settings on the Windows node
7. run `install.bat`
8. monitor the node from the dashboard

Important:

- the node's final live configuration is saved on the node
- the hub mirrors that node configuration for visibility and control
- the preferred flow is `discovery report -> provisioned config -> save local settings`
- the enrollment key is a fallback, not the preferred path

---

## Before You Begin

Make sure you have:

- a Clarix Pulse account that has already been enabled
- your email, password, and access key
- a Windows node where you can unpack the installer bundle
- access to the monitored playout machine while the player is running if possible

Helpful terms:

- `Workspace`: your customer account inside Clarix Pulse
- `Node`: the Windows machine being monitored
- `Site`: the logical group/location for a node
- `Player`: one monitored playout instance on a node
- `Provision`: generate the final tenant-scoped node config from the hub
- `Install handoff page`: a temporary public page that bundles the installer and that node's secure config link for a field operator

---

## Part 1 - Public Hub Pages

### 1. Register Page

Open `Register` when you need to create a new customer workspace.

Fields:

- `Company name`: the customer or organization name shown inside the workspace
- `Your name`: the first user name for the account
- `Email`: the sign-in email for that first user
- `Password`: the sign-in password

Buttons:

- `Create account`: creates the workspace and the first user
- `Already registered? Sign in`: returns to the login page

What happens after registration:

- Clarix Pulse creates a 365-day access key
- if email delivery is configured, the key is emailed
- if email delivery is unavailable, the fallback access key is shown once on screen
- new customer accounts start disabled by default until a platform admin enables them

What the `Access key fallback` box means:

- it appears only when automatic email delivery is unavailable
- it is a one-time fallback view of the access key
- store it safely because the user will need it for login

### 2. Login Page

Use this page to enter the workspace.

Fields:

- `Email`: your account email
- `Password`: your password
- `Access key`: the workspace access key; platform admin accounts can leave this blank

Buttons:

- `Sign in`: logs into the workspace
- `Forgot password`: opens the password-reset request page
- `Create a new account`: opens registration

Extra notes:

- the access key input automatically formats the key in groups
- if a recent registration had no email delivery, an `Access key fallback` block can appear here once

### 3. Forgot Password Page

Use this when a user cannot remember the password.

Field:

- `Email`: the account email to recover

Buttons:

- `Send reset link`: asks Clarix Pulse to send a reset link if the email exists
- `Back to sign in`: returns to login

Important:

- the response is intentionally generic and does not confirm whether the email exists
- password reset changes the password only
- the tenant, access key, and node configuration do not change

### 4. Reset Password Page

Use this page after opening a reset link from email or after a platform admin sends a fallback token.

Fields:

- `Token`: the password-reset token
- `New password`: the new password
- `Confirm password`: repeat the new password

Buttons:

- `Update password`: saves the new password
- `Back to sign in`: returns to login

Validation:

- the token must exist
- the password must be at least 8 characters
- the new password and confirm password must match

---

## Part 2 - Signed-In App Shell

After login, the top app shell is the same across the dashboard pages.

### Main Navigation Buttons

- `Dashboard`: opens the live monitoring view
- `Onboarding`: opens the guided first-node setup page
- `Account`: opens workspace details, installer access, and access status
- `Admin`: visible only to platform admins
- `Sign out`: ends the session

### Support Mode Banner

This appears only when a platform admin is viewing a tenant workspace in support mode.

Button:

- `Return to admin`: exits the tenant workspace and returns to the admin workspace

Header information:

- tenant slug
- tenant name
- signed-in user name
- signed-in user email
- whether access is active or still pending
- the current default alert email

---

## Part 3 - Adding a Node from the Hub

This is the main operator workflow.

### Step 1 - Open the Onboarding Page

The onboarding page is the fastest way to start the first node.

#### Section: Recommended onboarding flow

Card 1: `Get the installer`

Buttons:

- `Download installer`: downloads the Windows bundle directly in the signed-in browser
- `Create secure link`: creates an expiring direct-download link for the installer
- `Copy secure link`: copies that direct installer link after it is created

What the secure installer link is for:

- use it with `install-from-url.ps1`
- use it in another browser session
- use it when the operator on the Windows machine should not sign into the dashboard

Card 2: `Import the discovery report`

What it means:

- the Windows node runs discovery first
- you then upload the discovery report in `Remote Setup`
- the dashboard uses that report to prefill node and player details

Card 3: `Finish local install`

What it means:

- after provisioning, the hub gives you a final `config.yaml`
- you import that config into the Windows node local UI
- then you save the settings and install the Windows service

#### Section: Install checklist

Button:

- `Open remote provisioning`: jumps to the main dashboard so you can use `Remote Setup`

#### Side cards

- `Default alert recipient`: shows the email that will receive alerts first
- `Enrollment key fallback`: shows the workspace enrollment key for fallback use only

### Step 2 - Open the Dashboard

The live dashboard is where provisioning and daily monitoring happen.

#### Top controls

- `Show inactive (N)` or `Hide inactive sites`: toggles whether uncommissioned or inactive sites are shown
- `Open onboarding`: visible when the dashboard prompts a first-time user to start setup
- `Start onboarding`: visible when there are no nodes yet for the workspace

Connection panel:

- shows the date, time, and socket status
- `Connected` means live updates are flowing
- `Syncing` means the dashboard is reconnecting
- `Disconnected` means live updates are currently not flowing

### Step 3 - Use Remote Setup

`Remote Setup` is the most important hub panel for adding a node.

#### Top action row

- `Upload discovery report`: uploads a JSON or YAML discovery report from the Windows node
- `Add player`: manually adds a player section if discovery did not provide one
- `Clear form`: resets the current draft and removes the last provision summary from the panel

What happens when you upload a report:

- node identity fields are filled automatically when possible
- player sections are created automatically when possible
- the form becomes a draft that you can edit before provisioning

#### Node Identity section

Fields:

- `Node ID`: the stable node identifier
- `Node Name`: the friendly name shown in the dashboard
- `Site ID`: the group/site identifier
- `Hub URL`: the base hub URL the node will report to
- `Poll Interval`: how often the node posts a heartbeat

What each field is for:

- `Node ID` should be stable and unique
- `Node Name` is the human-friendly label
- `Site ID` controls grouping on the live dashboard
- `Hub URL` must point to the correct Clarix Pulse hub
- `Poll Interval` controls how frequently the node reports

#### Player card

Each player block represents one monitored playout instance.

Top buttons:

- `Monitoring enabled` or `Monitoring disabled`: controls whether the player starts with monitoring on
- `Advanced` or `Hide advanced`: shows or hides advanced selectors and UDP JSON blocks
- `Remove`: removes that player from the draft

Fields:

- `Player ID`: the stable player identifier inside the node
- `Display Label`: the friendly display name for the player
- `Playout Profile`: selects the profile that matches the monitored software

Path fields change by profile:

- generic profiles show `Primary Log Path`, `Content Error Log`, and `Scan Log`
- `Indytek Insta` shows `Shared Log Dir`, `Instance Root`, and `FNF Log`
- `Admax` shows `Admax Root`, `FNF Log`, and `Scan Log`

Advanced fields:

- `Playlist / Secondary Log`
- `Process Selectors JSON`
- `Log Selectors JSON`
- `UDP Inputs JSON`

Use advanced fields only when the default detection is not enough.

#### Provision button

Button:

- `Provision node and download config`: validates the draft, creates or updates the tenant-scoped node entry, rotates a fresh agent token, mirrors the config on the hub, and downloads the final `config.yaml`

After provisioning, the `Last Provision` card appears.

#### Last Provision card

This card is the "what happened just now" summary for the latest provision action.

It shows:

- node ID
- site ID
- update time
- confirmation that a fresh agent token was bundled into the config

#### Secure config link section

If hub signing is enabled, this block appears after provisioning.

Button:

- `Copy secure config link`: copies the expiring config URL for use in the Windows node local UI

What it is for:

- paste it into the node local UI field `Pull Setup From URL`
- use it with `Pull from link`
- avoid moving files manually when the node can reach the hub

#### Shareable install handoff section

This section is for a field operator who should finish setup without signing into the dashboard.

Buttons:

- `Create install handoff page`: creates a public expiring page for this specific provisioned node
- `Copy handoff link`: copies that public page after it is created

What the handoff page includes:

- an installer download
- that node's secure config link
- a simple step list for the person finishing setup on the Windows node

### Step 4 - Optional Install Handoff Page

When you open the public handoff page, it shows:

- the target node name
- the workspace name
- the link expiry time
- an operator-friendly install checklist

Buttons:

- `Download installer`: downloads the Windows bundle
- `Download node config`: downloads the ready `config.yaml`
- `Copy config link`: copies the secure config link for the local UI
- `Copy this handoff page`: copies the public page URL again
- `Back to Clarix Pulse`: returns to the login page

Use this page when:

- the field operator should not sign into the dashboard
- you want to reduce mistakes by bundling the right installer and config together

---

## Part 4 - Account Page

The `Account` page is the workspace information page.

### Account details

This area shows:

- company name
- workspace slug
- signed-in user

### Installer access

Buttons:

- `Download Clarix Pulse for Windows`: downloads the Windows bundle
- `Create secure install link`: creates an expiring direct installer link
- `Copy secure link`: copies the installer link after it is generated

Use this page when:

- you want installer access without reopening the onboarding page
- you want to hand a direct installer link to another operator

### Install workspace app

This area helps the user install the dashboard as a web app on another device.

Buttons:

- `Install app`: visible only when the browser supports install and the app is not already installed
- `Share link`: shares the current workspace URL using the device share sheet when supported
- `Copy link`: copies the workspace URL
- `Show QR` or `Hide QR`: shows or hides the QR code on smaller screens

Use this area when:

- you want the dashboard pinned on a phone, tablet, or operations display
- you want to open the same workspace on another device quickly

### Access status

This card shows:

- whether the workspace is enabled
- any disabled reason
- access key hint
- access key expiry time

### Alert default

This card explains which email currently receives alerts by default.

### Enrollment key fallback

This card shows the workspace enrollment key.

Use it only when:

- you cannot use a provisioned config
- you are deliberately using the fallback enrollment flow

---

## Part 5 - Windows Node Setup

This is the second half of the onboarding flow.

### Step 1 - Put the bundle on the Windows node

The installer bundle usually contains:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `discover-node.ps1`
- `install-from-url.ps1`
- `config.yaml`
- `config.example.yaml`

### Step 2 - Run discovery

Typical command:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

What discovery does:

- scans the machine for likely player software
- finds likely logs and directories
- builds a discovery report you can upload in `Remote Setup`

### Step 3 - Open the local UI

Use:

```bat
configure.bat
```

The persistent local UI lives at:

```text
http://127.0.0.1:3210/
```

If the persistent UI is not already running, `configure.bat` can open a temporary guided setup view first.

### Local UI - Node section

Fields:

- `Node ID`
- `Node Name`
- `Site ID`
- `Hub URL`
- `Agent Token`
- `Enrollment Key`
- `Poll Interval (Seconds)`

What these mean:

- `Node ID`: the permanent node identity
- `Node Name`: the label users see in the dashboard
- `Site ID`: the dashboard grouping value
- `Hub URL`: where the node sends heartbeats and pulls config from
- `Agent Token`: the preferred authenticated identity issued by provisioning
- `Enrollment Key`: fallback only; used when no agent token is available yet
- `Poll Interval (Seconds)`: how often the node sends heartbeat data

Sensitive settings lock:

- if the node is already enrolled or provisioned, some identity fields lock automatically
- `Unlock sensitive settings`: temporarily allows editing locked identity and registration fields

Use `Unlock sensitive settings` only when you intentionally want to:

- rename or move a node
- re-register the node
- add or remove players after the identity has already been locked

### Local UI - Import Setup section

This section is the safest way to load node settings.

Buttons:

- `Upload report or config`: imports either a discovery report or a provisioned `config.yaml`
- `Pull from link`: pulls a config from a secure hub URL or another direct HTTPS file URL

Field:

- `Pull Setup From URL`: paste the secure config link here before pressing `Pull from link`

Best practice:

- use a provisioned `config.yaml` or secure config link from the hub
- use the discovery report first only to help fill the form
- then save the final provisioned configuration locally

### Local UI - Players section

Each player block represents one monitored player on that node.

Top buttons:

- `+ Add player`: creates a new player section
- `Advanced` or `Hide advanced`: toggles advanced selectors for the player
- `Remove player`: deletes that player from the local configuration

Player fields:

- `Player ID`
- `Playout Type`
- profile-specific path fields such as `Shared Log Dir`, `Admax Root`, `Primary Log File / Folder`, `FNF Log`, and `Playlist Scan Log`

What `Playout Type` does:

- changes the path layout and defaults shown in the editor
- helps the agent interpret logs and process behavior correctly

Advanced Selectors section:

- `Process Names`
- `Window Title Contains`
- `Process Regex`
- `Window Title Regex`
- `Log Include Contains`
- `Log Exclude Contains`
- `Paused Regex`
- `Played Regex`
- `Skipped Regex`
- `Exited Regex`
- `Reinit Regex`
- `Token Patterns`

Use these only when default profile behavior is not enough.

### Local UI - Streams section

Inside each player, the stream area controls UDP and thumbnail monitoring.

Buttons:

- `+ Add stream`: adds a stream input under that player
- `Monitoring on` or `Monitoring off`: enables or disables that stream input
- `Remove`: removes that stream input

Stream fields:

- `Stream ID`
- `Thumbnail Interval (Seconds)`
- `Stream URL`

Meaning:

- `Stream ID`: the unique stream entry name for that player
- `Thumbnail Interval (Seconds)`: how often the node captures thumbnails for that stream
- `Stream URL`: the UDP or stream address to monitor

### Local UI - Bottom action buttons

- `Save Local Settings`: writes the current state to local `config.yaml`
- `Reload from disk`: discards unsaved changes and reloads the saved local config

Best practice:

- use `Save Local Settings` after importing or changing configuration
- use `Reload from disk` when you want to undo unsaved edits and return to the saved local state

### Step 4 - Install the service

After saving local settings, run:

```bat
install.bat
```

What this does:

- uses the saved local settings
- installs the Windows service
- starts the service so the node begins reporting to the hub

### Step 5 - Verify the node is online

Back in the dashboard, confirm:

- the node appears under the right site
- the last heartbeat time updates
- the player status badges make sense
- alarms and stream thumbnails appear when expected

---

## Part 6 - Daily Monitoring on the Dashboard

Once a node is live, the dashboard becomes the daily operating screen.

### Alarm banner

The red banner appears when one or more instances are in alarm.

Buttons:

- `Enable sound`: shown only when the browser blocked alarm audio and the user must explicitly allow it
- `Turn off alarm sound` or `Alarm sound off`: toggles the alarm audio

Use it when:

- you need audible alarm awareness
- you want to silence the tone without hiding the visual alarm condition

### Site group header

The site group can show badges such as:

- `INACTIVE`
- `NETWORK`
- `OFFLINE`
- `OFF AIR`

These are status indicators, not buttons.

### Instance card

Each player appears as an instance card.

It shows:

- instance label
- playout type
- node ID
- player ID
- runtime status
- network status
- last heartbeat age
- optional UDP summary
- optional selected stream
- optional thumbnail

#### Monitoring Controls

Buttons:

- `Maintenance on` or `Maintenance off`: pauses alarms and alerts during maintenance work
- `Monitoring on` or `Monitoring off`: turns that player into or out of the live alarming system

Use `Maintenance` when:

- the player should stay visible
- alarms should pause temporarily while engineering work happens

Use `Monitoring off` when:

- the player should not be part of live alarming at all
- you are intentionally removing it from normal monitoring

#### Local mirror

Button:

- `Local mirror` or `Hide mirror`: opens the mirrored node-side config view for that player

This view is read-only.

It shows:

- playout type
- mirror source
- resolved paths
- advanced selectors
- stream inputs and whether they are enabled

Use it when:

- you want to confirm what the node currently has saved
- you need visibility without editing the Windows node directly

### Alert Contacts panel

This panel controls who receives alerts for the whole workspace.

Top button:

- `Alert settings` or `Hide settings`: opens or closes the editor

Inside the editor:

- `Enabled` or `Disabled` on `Email Recipients`: turns email delivery on or off
- `Enabled` or `Disabled` on `Telegram Recipients`: turns Telegram delivery on or off
- `Refresh`: reloads Telegram conversations when Telegram delivery is configured
- `Add` beside a Telegram target: adds that Telegram chat ID to the recipient list
- `Enabled` or `Disabled` on `Phone Contacts`: turns phone delivery on or off
- `Apply alert contacts`: saves the workspace alert contact settings

Limits:

- the UI supports up to three email recipients
- up to three Telegram chat IDs
- up to three phone numbers

Important:

- these contacts apply to alerts from every node in the account

---

## Part 7 - Platform Admin Appendix

This section is only for platform admins.

### Admin page purpose

The admin page is where platform admins manage tenant access and help customers without asking for their password.

### Admin actions per tenant

Buttons:

- `Open workspace`: enters that tenant's workspace in support mode
- `Send reset link`: sends or generates a password reset link for the tenant owner
- `Enable account` or `Disable account`: controls whether the tenant can use the platform
- `Delete account`: permanently removes the tenant account and its data

Other admin actions:

- access-key renewal can reveal a fallback key when email delivery is unavailable
- reset-link generation can reveal a fallback reset link when email delivery is unavailable

Fallback action buttons:

- `Copy fallback key`
- `Copy reset link`

Support mode:

- after `Open workspace`, the admin sees the tenant workspace with a support banner
- use `Return to admin` in the banner to exit support mode

### Recent support activity

This section is for visibility and audit history.

It helps answer:

- who enabled a tenant
- who opened a workspace in support mode
- who issued a password reset
- who deleted a tenant

---

## Part 8 - Recommended Step-By-Step for Adding One New Node

Use this exact sequence for the safest result:

1. Sign into the workspace from the hub.
2. Open `Onboarding`.
3. Click `Download installer` or `Create secure link`.
4. Move the bundle to the Windows node and unpack it.
5. Start the monitored playout software if possible.
6. Run `discover-node.ps1`.
7. Return to the dashboard and open `Dashboard`.
8. In `Remote Setup`, click `Upload discovery report`.
9. Review `Node ID`, `Node Name`, `Site ID`, `Hub URL`, and `Poll Interval`.
10. Review each player card.
11. Use `Advanced` only if the defaults are not enough.
12. Click `Provision node and download config`.
13. Either move the downloaded `config.yaml` to the node, or use `Copy secure config link`.
14. On the Windows node, open `configure.bat`.
15. In the local UI, use `Upload report or config` or paste the link into `Pull Setup From URL` and press `Pull from link`.
16. Review the imported configuration.
17. Click `Save Local Settings`.
18. Run `install.bat`.
19. Return to the dashboard and confirm the node is live.

Optional simplified field-operator flow:

1. Complete steps 1 through 12.
2. In `Last Provision`, click `Create install handoff page`.
3. Send that link to the field operator.
4. The field operator opens the page, clicks `Download installer`, then `Download node config` or `Copy config link`.
5. The field operator finishes the local setup and runs `install.bat`.

---

## Common Mistakes To Avoid

- Do not rely on the enrollment key when you already have a provisioned config.
- Do not forget to click `Save Local Settings` on the Windows node.
- Do not edit locked identity fields unless you intentionally want to re-register or move the node.
- Do not assume the handoff page lasts forever; it is expiring by design.
- Do not leave a player in `Monitoring off` if you expect alarms.
- Do not leave a player in `Maintenance on` after the work is finished.

---

## Related Docs

- quick onboarding: [ONBOARDING.md](/D:/monitoring/docs/ONBOARDING.md)
- agent install guide: [AGENT_INSTALL.md](/D:/monitoring/docs/AGENT_INSTALL.md)
- deployment guide: [DEPLOYMENT.md](/D:/monitoring/docs/DEPLOYMENT.md)
- architecture: [ARCHITECTURE.md](/D:/monitoring/docs/ARCHITECTURE.md)
