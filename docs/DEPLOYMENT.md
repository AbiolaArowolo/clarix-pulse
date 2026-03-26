# Clarix Pulse — VPS Deployment Guide

**Version**: 1.0.0
**Date**: 2026-03-26

---

## Infrastructure

| Component | Value |
|---|---|
| VPS | RackNerd 2.5GB KVM |
| IP | 192.3.76.144 |
| OS | Ubuntu 22.04 LTS |
| Domain | pulse.clarixtech.com |
| DNS | Cloudflare (proxied, Full strict SSL) |

---

## 1. Initial VPS Setup

```bash
ssh root@192.3.76.144

# Update system
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version   # v20.x.x
npm --version

# Install PM2
npm install -g pm2

# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Install git
apt install -y git

# Install ffmpeg (for potential future hub-side use)
apt install -y ffmpeg
```

---

## 2. Clone and Build

```bash
# Clone repo
cd /var/www
git clone https://github.com/AbiolaArowolo/clarix-pulse.git
cd clarix-pulse

# Create .env.local with secrets (NEVER commit this file)
cp .env.example .env.local
nano .env.local
# Fill in: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SMTP_*, AGENT_TOKENS

# Install dependencies
npm install

# Build hub TypeScript
npm run build --workspace=packages/hub

# Build dashboard (static files)
npm run build --workspace=packages/dashboard
```

---

## 3. Configure Caddy

```bash
nano /etc/caddy/Caddyfile
```

Replace contents with:

```
pulse.clarixtech.com {
    reverse_proxy /api/* localhost:3001
    reverse_proxy /socket.io/* localhost:3001 {
        header_up Connection {http.upgrade}
        header_up Upgrade {http.upgrade}
    }
    root * /var/www/clarix-pulse/packages/dashboard/dist
    file_server
}
```

```bash
# Reload Caddy
systemctl reload caddy
systemctl enable caddy
```

---

## 4. Cloudflare DNS Setup

In Cloudflare dashboard (clarixtech.com zone):

1. Add DNS record:
   - Type: `A`
   - Name: `pulse`
   - Value: `192.3.76.144`
   - Proxy: **Proxied** (orange cloud ☁️)

2. SSL/TLS settings:
   - Mode: **Full (strict)**

3. WebSockets: enabled by default on proxied subdomains (no action needed)

---

## 5. Start Hub with PM2

```bash
cd /var/www/clarix-pulse

# Start hub
pm2 start packages/hub/dist/index.js --name clarix-hub --env production

# Set to auto-start on server reboot
pm2 startup
pm2 save

# Check status
pm2 status
pm2 logs clarix-hub
```

---

## 6. Verify Deployment

```bash
# Hub health check (from VPS)
curl http://localhost:3001/api/health
# Expected: {"ok":true,"ts":"..."}

# Dashboard (from browser)
# https://pulse.clarixtech.com/
# Expected: Clarix Pulse dashboard loads, shows 7 instances in gray (no agents yet)

# Test heartbeat (from VPS)
curl -X POST https://pulse.clarixtech.com/api/heartbeat \
  -H "Authorization: Bearer <ny-main-pc-token>" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"ny-main-pc","instanceId":"ny-main-insta-1","timestamp":"2026-03-26T10:00:00Z","observations":{"playout_process_up":1,"playout_window_up":1,"internet_up":1,"gateway_up":1}}'
# Expected: {"ok":true,"broadcastHealth":"healthy","runtimeHealth":"healthy","connectivityHealth":"online"}
```

---

## 7. Updates (Rolling Deploy)

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

## 8. Backup

The only stateful file is the SQLite database:

```bash
# Manual backup
cp packages/hub/data/clarix.db packages/hub/data/clarix.db.bak

# Add to crontab for daily backup
crontab -e
# 0 3 * * * cp /var/www/clarix-pulse/packages/hub/data/clarix.db /var/backups/clarix-$(date +\%Y\%m\%d).db
```
