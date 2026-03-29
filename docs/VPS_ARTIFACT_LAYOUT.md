# Clarix Pulse - VPS Artifact Layout

**Document Date**: `2026-03-29 -04:00`

## Purpose

This guide defines the stable download layout for:

1. the Clarix Pulse bundle zip
2. tenant-provisioned node `config.yaml` files

These are different files and serve different parts of setup.

---

## Recommended URL Model

```text
https://pulse.clarixtech.com/downloads/clarix-pulse/latest/clarix-pulse-v1.9.zip
https://pulse.clarixtech.com/downloads/nodes/<node-id>/config.yaml
```

Meaning:

- the first URL is the stable installer link for operators
- the second URL is the stable config link for one specific node

---

## Recommended Filesystem Layout

```text
/var/www/clarix-pulse/packages/dashboard/dist
/var/www/clarix-pulse-downloads/clarix-pulse/v1.9/clarix-pulse-v1.9.zip
/var/www/clarix-pulse-downloads/clarix-pulse/latest/clarix-pulse-v1.9.zip
/var/www/clarix-pulse-downloads/nodes/<node-id>/config.yaml
```

---

## How Setup Uses These Files

### Bundle zip

Used to get the software onto a Windows node.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-from-url.ps1 -BundleUrl "https://pulse.clarixtech.com/downloads/clarix-pulse/latest/clarix-pulse-v1.9.zip"
```

### Discovery report

Created locally on the node:

```powershell
powershell -ExecutionPolicy Bypass -File .\discover-node.ps1
```

This writes:

```text
.\pulse-node-discovery-report.json
```

That file is uploaded into the dashboard or local UI to auto-fill detected paths, players, and log locations.

### Provisioned `config.yaml`

Created by the signed-in dashboard for one specific tenant/node.

That file is then:

- downloaded directly after provisioning
- or hosted at `/downloads/nodes/<node-id>/config.yaml`

The local UI can import it or pull it by URL.

---

## Recommended Operator Flow

1. Sign in to the correct tenant dashboard.
2. Pull the bundle zip from the stable Clarix Pulse URL.
3. Run discovery on the Windows node while the player is active.
4. Upload the discovery report in `Remote Setup`.
5. Provision the node and download the final `config.yaml`.
6. Optionally publish that same `config.yaml` to `/downloads/nodes/<node-id>/config.yaml`.
7. Import that config into the local UI.
8. Save local settings and install the service.

---

## Caddy Example

```caddy
pulse.clarixtech.com {
    root * /var/www/clarix-pulse/packages/dashboard/dist
    try_files {path} /index.html
    file_server

    handle_path /downloads/* {
        root * /var/www/clarix-pulse-downloads
        file_server
    }

    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
}
```

---

## Protection Model

Current node download behavior is simple:

- `install-from-url.ps1` uses a direct `http(s)` GET
- local UI `Pull from link` also uses a direct `http(s)` GET

So the URL must resolve directly to the file.

Works well:

- direct HTTPS URLs
- presigned URLs
- signed query-string URLs

Not supported well today:

- login pages
- custom-header-only downloads
- interactive browser-gated flows

---

## Publishing Rule

When a node is provisioned or reprovisioned, update:

```text
/var/www/clarix-pulse-downloads/nodes/<node-id>/config.yaml
```

That keeps the node's setup URL stable even when the token changes.
