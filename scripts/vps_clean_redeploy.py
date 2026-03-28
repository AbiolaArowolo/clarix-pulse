from __future__ import annotations

import argparse
import time
from pathlib import Path

import paramiko


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def safe(text: str) -> str:
    return text.encode("ascii", "backslashreplace").decode("ascii")


def run(ssh: paramiko.SSHClient, command: str, timeout: int = 900) -> None:
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if out.strip():
        print(safe(out.strip()))
    if err.strip():
        print("--- stderr ---")
        print(safe(err.strip()))
    if exit_code != 0:
        raise RuntimeError(f"Command failed ({exit_code}): {command}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=str(Path("d:/monitoring/.env.local")))
    parser.add_argument("--archive", required=True)
    parser.add_argument("--remote-app", default="/var/www/clarix-pulse")
    args = parser.parse_args()

    env = load_env(Path(args.env_file))
    host = env["VPS_HOST"]
    user = env["VPS_USER"]
    password = env["VPS_ROOT_PASSWORD"]

    archive_path = Path(args.archive)
    if not archive_path.exists():
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    timestamp = time.strftime("%Y%m%d%H%M%S")
    backup_root = f"/root/pulse-clean-backup-{timestamp}"
    remote_archive = f"/root/pulse-clean-deploy-{timestamp}.tar.gz"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host, username=user, password=password, timeout=20)

    try:
        print("=== upload ===")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(archive_path), remote_archive)
        finally:
            sftp.close()

        print("=== backup ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"mkdir -p {backup_root}; "
                f"if [ -f {args.remote_app}/.env ]; then cp {args.remote_app}/.env {backup_root}/.env; fi; "
                f"if [ -f {args.remote_app}/.env.local ]; then cp {args.remote_app}/.env.local {backup_root}/.env.local; fi; "
                f"DEFAULT_DB_PATH={args.remote_app}/packages/hub/data/clarix.db; "
                "DB_PATH=\"\"; "
                f"if [ -f {args.remote_app}/.env ]; then DB_PATH=$(grep -m1 \"^PULSE_DB_PATH=\" {args.remote_app}/.env | cut -d= -f2- || true); fi; "
                f"if [ -f {args.remote_app}/.env.local ]; then DB_PATH_OVERRIDE=$(grep -m1 \"^PULSE_DB_PATH=\" {args.remote_app}/.env.local | cut -d= -f2- || true); "
                "if [ -n \"$DB_PATH_OVERRIDE\" ]; then DB_PATH=\"$DB_PATH_OVERRIDE\"; fi; fi; "
                "if [ -n \"$DB_PATH\" ] && [ \"$DB_PATH\" != \"$DEFAULT_DB_PATH\" ] && [ -f \"$DEFAULT_DB_PATH\" ]; then "
                "mkdir -p \"$(dirname \"$DB_PATH\")\"; "
                "if [ ! -f \"$DB_PATH\" ]; then cp -a \"$DEFAULT_DB_PATH\" \"$DB_PATH\"; fi; "
                "fi; "
                f"ls -la {backup_root}'"
            ),
        )

        print("=== stop and clean ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                "pm2 delete clarix-hub || true; "
                f"mkdir -p {args.remote_app}; "
                f"find {args.remote_app} -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {{}} +'"
            ),
            timeout=300,
        )

        print("=== extract ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"tar -xzf {remote_archive} -C {args.remote_app}; "
                f"if [ -f {backup_root}/.env ]; then cp {backup_root}/.env {args.remote_app}/.env; fi; "
                f"if [ -f {backup_root}/.env.local ]; then cp {backup_root}/.env.local {args.remote_app}/.env.local; fi; "
                f"ls -la {args.remote_app}'"
            ),
            timeout=300,
        )

        print("=== npm install ===")
        run(
            ssh,
            f"bash -lc 'cd {args.remote_app} && npm install --no-fund --no-audit'",
            timeout=1800,
        )

        print("=== build hub ===")
        run(
            ssh,
            f"bash -lc 'cd {args.remote_app} && npm run build --workspace=packages/hub'",
            timeout=1800,
        )

        print("=== build dashboard ===")
        run(
            ssh,
            f"bash -lc 'cd {args.remote_app} && npm run build --workspace=packages/dashboard'",
            timeout=1800,
        )

        print("=== restart services ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"cd {args.remote_app} && "
                "pm2 start packages/hub/dist/index.js --name clarix-hub --update-env && "
                "pm2 save && "
                "systemctl reload caddy && "
                "curl -s http://localhost:3001/api/health'"
            ),
            timeout=300,
        )

        print("=== final status ===")
        run(
            ssh,
            (
                "bash -lc '"
                "pm2 status --no-color && "
                "systemctl is-active caddy && "
                f"ls -la {args.remote_app}/packages/dashboard/dist | head'"
            ),
            timeout=300,
        )
    finally:
        ssh.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
