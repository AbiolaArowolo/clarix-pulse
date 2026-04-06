#!/usr/bin/env python
"""
Clarix Pulse VPS deployment script using paramiko.
Uploads hub and dashboard dist files, restarts PM2, and verifies.
"""

import os
import sys
import io
import re
import posixpath
import zipfile
from pathlib import Path
import paramiko
import time

# Force UTF-8 stdout so PM2 box-drawing chars don't crash on Windows cp1252
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "192.3.76.144"
USER = "root"
PASSWORD = "63f9mJH8trSHp6s8GW"
PORT = 22

LOCAL_HUB_DIST = r"D:\monitoring\packages\hub\dist"
LOCAL_DASHBOARD_DIST = r"D:\monitoring\packages\dashboard\dist"
LOCAL_RELEASE_ROOT = Path(r"D:\monitoring\packages\agent\release")


def parse_bundle_version(name):
    match = re.search(r"clarix-pulse-v([\d.]+)\.zip$", name)
    if not match:
        return (0,)
    return tuple(int(part) for part in match.group(1).split("."))


def resolve_latest_bundle_paths():
    candidates = sorted(
        LOCAL_RELEASE_ROOT.glob("clarix-pulse-v*.zip"),
        key=lambda candidate: parse_bundle_version(candidate.name),
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"No installer ZIP found under {LOCAL_RELEASE_ROOT}")

    zip_path = candidates[0]
    bundle_dir = LOCAL_RELEASE_ROOT / zip_path.stem
    if not bundle_dir.exists():
        raise FileNotFoundError(f"Bundle directory not found for {zip_path.name}: {bundle_dir}")

    remote_zip = f"/var/www/clarix-pulse/packages/agent/release/{zip_path.name}"
    return str(bundle_dir), str(zip_path), remote_zip


def safe_print(text):
    """Print text, replacing unencodable characters."""
    print(text.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8", errors="replace"))


def ssh_run(client, cmd, desc=""):
    """Run a command and return (stdout, stderr, exit_code)."""
    safe_print(f"\n>>> {desc or cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    code = stdout.channel.recv_exit_status()
    if out:
        safe_print(out)
    if err:
        safe_print(f"[stderr] {err}")
    safe_print(f"[exit {code}]")
    return out, err, code


def sftp_upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload a local directory to a remote directory."""
    # Ensure remote dir exists
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        print(f"  mkdir {remote_dir}")
        sftp.mkdir(remote_dir)

    for entry in os.scandir(local_dir):
        local_path = entry.path
        remote_path = posixpath.join(remote_dir, entry.name)
        if entry.is_dir():
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                print(f"  mkdir {remote_path}")
                sftp.mkdir(remote_path)
            sftp_upload_dir(sftp, local_path, remote_path)
        else:
            print(f"  upload {local_path} -> {remote_path}")
            sftp.put(local_path, remote_path)


def main():
    print("=" * 60)
    print("Clarix Pulse VPS Deploy")
    print("=" * 60)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {HOST}:{PORT} as {USER}...")
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=30)
    print("Connected.")

    local_release_dir, local_installer_zip, remote_installer_zip = resolve_latest_bundle_paths()

    # -- Step 1: Discover PM2 hub entry point ---------------------------------
    print("\n" + "=" * 60)
    print("STEP 1: Discover hub entry point")
    print("=" * 60)

    pm2_out, _, _ = ssh_run(client,
        "pm2 show clarix-hub 2>/dev/null | grep -E 'script|cwd|root path'",
        "PM2 show clarix-hub")

    # Also check candidate directories
    ssh_run(client, "ls /var/www/clarix-pulse/ 2>/dev/null", "ls /var/www/clarix-pulse/")
    hub_dist_check, _, _ = ssh_run(client,
        "ls /var/www/clarix-pulse/dist/ 2>/dev/null | head -10",
        "ls /var/www/clarix-pulse/dist/")
    pkg_dist_check, _, _ = ssh_run(client,
        "ls /var/www/clarix-pulse/packages/hub/dist/ 2>/dev/null | head -10",
        "ls /var/www/clarix-pulse/packages/hub/dist/")

    # Determine correct remote hub dist path
    # Look for 'script' line in pm2 output to find index.js location
    remote_hub_dist = None
    for line in pm2_out.splitlines():
        if "script" in line.lower() and "index.js" in line:
            # Extract path from line like: | script path    | /var/www/.../index.js
            parts = line.split("|")
            for p in parts:
                p = p.strip()
                if p.endswith("index.js"):
                    remote_hub_dist = posixpath.dirname(p)
                    break
        if remote_hub_dist:
            break

    if not remote_hub_dist:
        # Fall back based on what directories exist
        if pkg_dist_check:
            remote_hub_dist = "/var/www/clarix-pulse/packages/hub/dist"
        elif hub_dist_check:
            remote_hub_dist = "/var/www/clarix-pulse/dist"
        else:
            # Default assumption
            remote_hub_dist = "/var/www/clarix-pulse/packages/hub/dist"

    print(f"\nResolved remote hub dist path: {remote_hub_dist}")

    # -- Step 2: Upload hub dist ----------------------------------------------
    print("\n" + "=" * 60)
    print(f"STEP 2: Upload hub dist -> {remote_hub_dist}")
    print("=" * 60)

    sftp = client.open_sftp()

    # Ensure all parent dirs exist
    parts = remote_hub_dist.rstrip("/").split("/")
    for i in range(2, len(parts) + 1):
        p = "/".join(parts[:i])
        if not p:
            continue
        try:
            sftp.stat(p)
        except FileNotFoundError:
            print(f"  mkdir {p}")
            sftp.mkdir(p)

    sftp_upload_dir(sftp, LOCAL_HUB_DIST, remote_hub_dist)
    print("Hub dist upload complete.")

    # -- Step 3: Discover dashboard static path -------------------------------
    print("\n" + "=" * 60)
    print("STEP 3: Discover dashboard static path")
    print("=" * 60)

    public_check, _, _ = ssh_run(client,
        "ls /var/www/clarix-pulse/public/ 2>/dev/null | head -10",
        "ls /var/www/clarix-pulse/public/")
    caddy_out, _, _ = ssh_run(client,
        "cat /etc/caddy/Caddyfile 2>/dev/null | grep -A50 'clarixtech.com'",
        "Caddyfile grep clarixtech.com")

    # Determine dashboard static path
    remote_dashboard = None

    # Parse Caddyfile for root/file_server path
    for line in caddy_out.splitlines():
        line = line.strip()
        if line.startswith("root") and ("*" in line or "/var/www" in line):
            # e.g. root * /var/www/clarix-pulse/public
            tokens = line.split()
            if len(tokens) >= 3:
                remote_dashboard = tokens[2]
            elif len(tokens) == 2:
                remote_dashboard = tokens[1]
            break

    if not remote_dashboard:
        if public_check:
            remote_dashboard = "/var/www/clarix-pulse/public"
        else:
            # Check if dashboard dist is next to hub dist
            alt_check, _, _ = ssh_run(client,
                "ls /var/www/clarix-pulse/packages/dashboard/dist/ 2>/dev/null | head -5",
                "ls dashboard/dist alt")
            if alt_check:
                remote_dashboard = "/var/www/clarix-pulse/packages/dashboard/dist"
            else:
                remote_dashboard = "/var/www/clarix-pulse/public"

    print(f"\nResolved remote dashboard path: {remote_dashboard}")

    # -- Upload dashboard dist -------------------------------------------------
    print("\n" + "=" * 60)
    print(f"STEP 3b: Upload dashboard dist -> {remote_dashboard}")
    print("=" * 60)

    # Ensure dashboard remote dir exists
    d_parts = remote_dashboard.rstrip("/").split("/")
    for i in range(2, len(d_parts) + 1):
        p = "/".join(d_parts[:i])
        if not p:
            continue
        try:
            sftp.stat(p)
        except FileNotFoundError:
            print(f"  mkdir {p}")
            sftp.mkdir(p)

    sftp_upload_dir(sftp, LOCAL_DASHBOARD_DIST, remote_dashboard)
    sftp.close()
    print("Dashboard dist upload complete.")

    # -- Step 3c: Repack installer ZIP from release folder --------------------
    print("\n" + "=" * 60)
    print("STEP 3c: Repack installer ZIP from release folder")
    print("=" * 60)

    print(f"  packing {local_release_dir} -> {local_installer_zip}")
    with zipfile.ZipFile(local_installer_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(local_release_dir):
            for fname in files:
                full = os.path.join(root, fname)
                arcname = os.path.relpath(full, os.path.dirname(local_release_dir))
                zf.write(full, arcname)
    zip_mb = os.path.getsize(local_installer_zip) / 1024 / 1024
    safe_print(f"  ZIP repacked: {zip_mb:.1f} MB")

    # -- Step 3d: Upload installer ZIP ----------------------------------------
    print("\n" + "=" * 60)
    print("STEP 3d: Upload installer ZIP -> " + remote_installer_zip)
    print("=" * 60)

    sftp = client.open_sftp()
    remote_zip_dir = posixpath.dirname(remote_installer_zip)
    try:
        sftp.stat(remote_zip_dir)
    except FileNotFoundError:
        ssh_run(client, f"mkdir -p {remote_zip_dir}", f"mkdir {remote_zip_dir}")

    zip_size_mb = os.path.getsize(local_installer_zip) / 1024 / 1024
    safe_print(f"  uploading {zip_size_mb:.1f} MB installer ZIP...")
    sftp.put(local_installer_zip, remote_installer_zip)

    # Also copy to the env-configured downloads dir so PULSE_DOWNLOAD_BUNDLE_PATH env
    # overrides (if set on the server) also serve the latest version.
    remote_dl_dir = "/var/lib/clarix-pulse/downloads"
    zip_basename = posixpath.basename(remote_installer_zip)
    remote_dl_zip = posixpath.join(remote_dl_dir, zip_basename)
    try:
        sftp.stat(remote_dl_dir)
    except FileNotFoundError:
        ssh_run(client, f"mkdir -p {remote_dl_dir}", f"mkdir {remote_dl_dir}")
    safe_print(f"  copying to downloads dir: {remote_dl_zip}")
    sftp.put(local_installer_zip, remote_dl_zip)

    sftp.close()
    safe_print("Installer ZIP upload complete.")

    # Update .env.local on VPS to remove stale PULSE_DOWNLOAD_BUNDLE_* overrides
    # so the auto-find code in downloads.ts takes over.
    print("\n" + "=" * 60)
    print("STEP 3e: Remove stale bundle env overrides from .env.local")
    print("=" * 60)
    ssh_run(client,
        "sed -i '/^PULSE_DOWNLOAD_BUNDLE_PATH=/d; /^PULSE_DOWNLOAD_BUNDLE_NAME=/d' "
        "/var/www/clarix-pulse/.env.local 2>/dev/null; echo 'done'",
        "Remove stale PULSE_DOWNLOAD_BUNDLE_* from .env.local")

    # -- Step 4: Restart PM2 and verify ---------------------------------------
    print("\n" + "=" * 60)
    print("STEP 4: Restart PM2 and verify")
    print("=" * 60)

    ssh_run(client, "pm2 restart clarix-hub --update-env", "PM2 restart")
    time.sleep(3)
    ssh_run(client, "pm2 status", "PM2 status")
    ssh_run(client, "pm2 logs clarix-hub --lines 20 --nostream", "PM2 logs (last 20)")

    # -- Step 6: Test live hub API --------------------------------------------
    print("\n" + "=" * 60)
    print("STEP 6: Test live hub API")
    print("=" * 60)

    api_out, _, code = ssh_run(client,
        "curl -s http://localhost:3001/api/auth/session | head -c 300",
        "curl /api/auth/session")

    client.close()

    print("\n" + "=" * 60)
    print("DEPLOY SUMMARY")
    print("=" * 60)
    print(f"Hub dist uploaded to:       {remote_hub_dist}")
    print(f"Dashboard dist uploaded to: {remote_dashboard}")
    print(f"Installer ZIP uploaded to:  {remote_installer_zip}")
    print(f"API response snippet:       {api_out[:200]}")

    if "authenticated" in api_out or "{" in api_out:
        print("\nDEPLOY SUCCESS: Hub API is responding.")
        return 0
    else:
        print("\nWARNING: Hub API response unexpected. Check PM2 logs.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
