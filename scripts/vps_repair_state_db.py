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


def run(ssh: paramiko.SSHClient, command: str, timeout: int = 300) -> None:
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
    parser.add_argument("--remote-app", default="/var/www/clarix-pulse")
    args = parser.parse_args()

    env = load_env(Path(args.env_file))
    host = env["VPS_HOST"]
    user = env["VPS_USER"]
    password = env["VPS_ROOT_PASSWORD"]
    timestamp = time.strftime("%Y%m%d%H%M%S")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host, username=user, password=password, timeout=20)

    try:
        print("=== repair state db ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"cd {args.remote_app}; "
                "pm2 delete clarix-hub || true; "
                f"DEFAULT_DB_PATH={args.remote_app}/packages/hub/data/clarix.db; "
                "DB_PATH=\"\"; "
                "if [ -f .env ]; then DB_PATH=$(grep -m1 \"^PULSE_DB_PATH=\" .env | cut -d= -f2- || true); fi; "
                "if [ -f .env.local ]; then DB_PATH_OVERRIDE=$(grep -m1 \"^PULSE_DB_PATH=\" .env.local | cut -d= -f2- || true); "
                "if [ -n \"$DB_PATH_OVERRIDE\" ]; then DB_PATH=\"$DB_PATH_OVERRIDE\"; fi; fi; "
                "if [ -z \"$DB_PATH\" ]; then DB_PATH=\"$DEFAULT_DB_PATH\"; fi; "
                f"DB_BACKUP_PATH=\"${{DB_PATH}}.corrupt.{timestamp}\"; "
                "mkdir -p \"$(dirname \"$DB_PATH\")\"; "
                "if [ -f \"$DB_PATH\" ]; then mv \"$DB_PATH\" \"$DB_BACKUP_PATH\"; fi; "
                "rm -f \"${DB_PATH}-shm\" \"${DB_PATH}-wal\"; "
                "pm2 start packages/hub/dist/index.js --name clarix-hub --update-env; "
                "pm2 save; "
                "sleep 3; "
                "curl -s http://localhost:3001/api/health; "
                "echo; "
                "ls -la \"$(dirname \"$DB_PATH\")\"'"
            ),
        )
    finally:
        ssh.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
