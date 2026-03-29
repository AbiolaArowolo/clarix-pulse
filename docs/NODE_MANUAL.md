# Clarix Pulse - Node Manual

**Document Date**: `2026-03-29 -04:00`

## Purpose

This manual covers the Windows node side of Clarix Pulse:

- bundle contents
- discovery
- local UI
- players and streams
- saving the config
- installing the Windows service

---

## 1. Bundle Contents

The standard Windows bundle can include:

- `clarix-agent.exe`
- `install.bat`
- `configure.bat`
- `uninstall.bat`
- `discover-node.ps1`
- `install-from-url.ps1`
- `config.yaml`
- `config.example.yaml`

---

## 2. Discovery

Use discovery before provisioning whenever possible.

Command:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

What discovery helps with:

- player detection
- log and folder detection
- auto-filling the dashboard draft

---

## 3. Open The Local UI

Run:

```bat
configure.bat
```

Persistent local UI address:

```text
http://127.0.0.1:3210/
```

---

## 4. Node Section

Fields:

- `Node ID`
- `Node Name`
- `Site ID`
- `Hub URL`
- `Agent Token`
- `Enrollment Key`
- `Poll Interval (Seconds)`

Bottom lock control:

- `Unlock sensitive settings`

Meaning:

- `Agent Token` is the preferred provisioned identity from the hub
- `Enrollment Key` is fallback only
- `Unlock sensitive settings` is for intentional re-registration or identity changes

---

## 5. Import Setup Section

This is the safest way to load a discovery report or provisioned config.

Field:

- `Pull Setup From URL`

Buttons:

- `Upload report or config`
- `Pull from link`

Best practice:

- use a provisioned `config.yaml` or secure config URL from the hub
- then save it locally with `Save Local Settings`

---

## 6. Players Section

Top button:

- `+ Add player`

Each player block has:

- `Advanced` or `Hide advanced`
- `Remove player`

Player fields:

- `Player ID`
- `Playout Type`
- profile-specific path fields

Advanced selector fields:

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

Use advanced selectors only when the normal playout profile needs help.

---

## 7. Streams Section

Each player can also hold multiple stream inputs.

Buttons:

- `+ Add stream`
- `Monitoring on` or `Monitoring off`
- `Remove`

Fields:

- `Stream ID`
- `Thumbnail Interval (Seconds)`
- `Stream URL`

Meaning:

- `Monitoring on/off` controls whether that stream input is actively monitored
- `Thumbnail Interval (Seconds)` controls thumbnail capture frequency

---

## 8. Bottom Action Buttons

- `Save Local Settings`
- `Reload from disk`

Use `Save Local Settings` when:

- you imported a new config
- you edited players, paths, or streams
- you changed node identity on purpose

Use `Reload from disk` when:

- you want to discard unsaved edits
- you want to return to the saved local config

---

## 9. Install The Windows Service

After saving local settings, run:

```bat
install.bat
```

That installs the Windows service and starts the node monitoring process.

---

## 10. If You Use A Handoff Page

If the hub operator gives you an install handoff page:

1. open the page
2. click `Download installer` if the bundle is not already on the node
3. click `Download node config` or copy the secure config URL
4. open `configure.bat`
5. import the config or use `Pull from link`
6. click `Save Local Settings`
7. run `install.bat`

---

## 11. Final Check

After install:

- confirm the Windows service starts
- confirm the hub dashboard shows fresh heartbeats
- confirm the player status and thumbnails look correct

---

## Related Docs

- full manual: [USER_MANUAL.md](/D:/monitoring/docs/USER_MANUAL.md)
- quick start: [QUICK_START.md](/D:/monitoring/docs/QUICK_START.md)
- hub manual: [HUB_MANUAL.md](/D:/monitoring/docs/HUB_MANUAL.md)
