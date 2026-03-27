# Pulse - Deployment Guide

**Version**: 1.0.0  
**Date**: 2026-03-27

---

## Infrastructure Requirements

Typical deployment:

| Component | Example |
|---|---|
| Hub host | Linux VPS, VM, or on-prem server |
| OS | Ubuntu 24.04 LTS |
| Domain | `monitor.example.com` |
| Reverse proxy | Caddy |
| Process manager | PM2 |
| DNS / CDN | optional |

---

## 1. Initial Server Setup

```bash
ssh root@your-server-ip

apt update && apt upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
npm install -g pm2

apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

---

## 2. Clone and Build

```bash
cd /var/www
git clone <your-repo-url> clarix-pulse
cd clarix-pulse

cp .env.example .env.local
nano .env.local

npm install
npm run build --workspace=packages/hub
npm run build --workspace=packages/dashboard
```

Fill in:

- `TELEGRAM_*`
- `SMTP_*`
- `AGENT_TOKENS`
- `CONFIG_WRITE_KEY` if dashboard-side UDP editing is desired

---

## 3. Configure the Reverse Proxy

Example Caddy configuration:

```caddy
monitor.example.com {
    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
    root * /var/www/clarix-pulse/packages/dashboard/dist
    file_server
}
```

Then:

```bash
systemctl reload caddy
systemctl enable caddy
```

---

## 4. Optional DNS / CDN

If using a DNS provider or CDN:

1. create an `A` or `CNAME` record for the dashboard domain
2. point it to the hub host
3. enable HTTPS according to your provider and proxy model

Pulse does not require a specific DNS provider.

---

## 5. Start the Hub

```bash
cd /var/www/clarix-pulse
pm2 start packages/hub/dist/index.js --name clarix-hub --env production
pm2 save
pm2 startup
```

Check:

```bash
pm2 status
pm2 logs clarix-hub
```

---

## 6. Verify Deployment

```bash
curl http://localhost:3001/api/health
```

Expected:

```json
{"ok":true,"ts":"..."}
```

From a browser:

- open `https://monitor.example.com`
- confirm the dashboard loads

Example heartbeat test:

```bash
curl -X POST https://monitor.example.com/api/heartbeat \
  -H "Authorization: Bearer <site-a-node-1-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId":"site-a-node-1",
    "playerId":"site-a-insta-1",
    "timestamp":"2026-03-27T12:00:00Z",
    "observations":{
      "playout_process_up":1,
      "playout_window_up":1,
      "internet_up":1,
      "gateway_up":1
    }
  }'
```

---

## 7. Mobile / PWA Install

The dashboard is installable as a PWA. Operators can use browser install prompts or add it to the home screen on mobile devices for faster access during monitoring and alert response.

---

## 8. Updates

```bash
cd /var/www/clarix-pulse
git pull
npm install
npm run build --workspace=packages/hub
npm run build --workspace=packages/dashboard
pm2 restart clarix-hub
systemctl reload caddy
```

---

## 9. Backups

The main stateful artifact is the SQLite database:

```bash
cp packages/hub/data/clarix.db packages/hub/data/clarix.db.bak
```

Automate backups with your preferred scheduler or host tooling.
