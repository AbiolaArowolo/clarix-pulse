from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import paramiko

ENV_SYNC_KEYS = (
    "PULSE_ADMIN_EMAILS",
    "PULSE_ACCESS_KEY_TTL_DAYS",
    "PULSE_DOWNLOAD_BUNDLE_PATH",
    "PULSE_DOWNLOAD_BUNDLE_NAME",
    "PULSE_DOWNLOAD_SIGNING_SECRET",
    "PULSE_DOWNLOAD_LINK_TTL_MINUTES",
)


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_env_override_lines(env: dict[str, str]) -> str:
    lines: list[str] = []
    for key in ENV_SYNC_KEYS:
        value = env.get(key)
        if value is None or value == "":
            continue
        lines.append(f"{key}={value}")
    return "\n".join(lines)


def run(ssh: paramiko.SSHClient, command: str, timeout: int = 900) -> str:
    stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    stdin.close()
    channel = stdout.channel

    out_chunks: list[str] = []
    err_chunks: list[str] = []

    while True:
        while channel.recv_ready():
            chunk = channel.recv(4096).decode("utf-8", "replace")
            out_chunks.append(chunk)
            print(safe(chunk), end="")

        while channel.recv_stderr_ready():
            chunk = channel.recv_stderr(4096).decode("utf-8", "replace")
            err_chunks.append(chunk)
            print(safe(chunk), end="")

        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break

        time.sleep(0.1)

    exit_code = channel.recv_exit_status()
    output = "".join(out_chunks)
    error_output = "".join(err_chunks)
    if exit_code != 0:
        raise RuntimeError(
            f"Command failed ({exit_code}): {command}\n{safe(output)}\n{safe(error_output)}"
        )

    return output


def detect_revision() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def detect_dirty_tree() -> bool:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            check=True,
            capture_output=True,
            text=True,
        )
        return bool(result.stdout.strip())
    except Exception:
        return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default=str(Path("d:/monitoring/.env.local")))
    parser.add_argument("--archive", required=True)
    parser.add_argument("--remote-app", default="/var/www/clarix-pulse")
    parser.add_argument("--revision", default=detect_revision())
    args = parser.parse_args()

    env = load_env(Path(args.env_file))
    host = env["VPS_HOST"]
    user = env["VPS_USER"]
    password = env["VPS_ROOT_PASSWORD"]

    archive_path = Path(args.archive)
    if not archive_path.exists():
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    archive_sha256 = sha256_file(archive_path)
    source_dirty = detect_dirty_tree()
    timestamp = time.strftime("%Y%m%d%H%M%S")
    backup_root = f"/root/pulse-deploy-backup-{timestamp}"
    remote_archive = f"/root/pulse-deploy-{timestamp}.tar.gz"
    remote_build_info = f"/root/pulse-build-info-{timestamp}.json"
    remote_env_override = f"/root/pulse-env-override-{timestamp}.env"
    staging_app = f"{args.remote_app}.staging-{timestamp}"
    previous_app = f"{args.remote_app}.previous-{timestamp}"
    failed_app = f"{args.remote_app}.failed-{timestamp}"
    env_override = build_env_override_lines(env)
    build_info = json.dumps(
        {
            "revision": args.revision,
            "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "archiveName": archive_path.name,
            "archiveSha256": archive_sha256,
            "sourceDirty": source_dirty,
        }
    )

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host, username=user, password=password, timeout=20)

    cutover_attempted = False
    deploy_succeeded = False

    try:
        print("=== upload ===")
        sftp = ssh.open_sftp()
        try:
            sftp.put(str(archive_path), remote_archive)
            with sftp.file(remote_build_info, "w") as remote_file:
                remote_file.write(build_info)
            if env_override:
                with sftp.file(remote_env_override, "w") as remote_file:
                    remote_file.write(env_override)
        finally:
            sftp.close()

        print("=== verify archive sha ===")
        remote_sha = run(
            ssh,
            f"bash -lc \"sha256sum {remote_archive} | awk '{{print \\$1}}'\"",
            timeout=120,
        ).strip()
        if remote_sha.lower() != archive_sha256.lower():
            raise RuntimeError(
                f"Uploaded archive hash mismatch. Local={archive_sha256} Remote={remote_sha}"
            )

        print("=== backup env ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"mkdir -p {backup_root}; "
                f"if [ -f {args.remote_app}/.env ]; then cp {args.remote_app}/.env {backup_root}/.env; fi; "
                f"if [ -f {args.remote_app}/.env.local ]; then cp {args.remote_app}/.env.local {backup_root}/.env.local; fi; "
                f"ls -la {backup_root}'"
            ),
        )

        print("=== prepare staging ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                f"rm -rf {staging_app}; "
                f"mkdir -p {staging_app}; "
                f"tar -xzf {remote_archive} -C {staging_app}; "
                f"if [ -f {backup_root}/.env ]; then cp {backup_root}/.env {staging_app}/.env; fi; "
                f"if [ -f {backup_root}/.env.local ]; then cp {backup_root}/.env.local {staging_app}/.env.local; fi; "
                f"if [ -f {remote_env_override} ]; then "
                f"touch {staging_app}/.env.local; "
                f"while IFS= read -r line; do "
                f"[ -z \"$line\" ] && continue; "
                f"key=${{line%%=*}}; "
                f"tmp=$(mktemp); "
                f"grep -v \"^${{key}}=\" {staging_app}/.env.local > \"$tmp\" || true; "
                f"printf \"%s\\n\" \"$line\" >> \"$tmp\"; "
                f"mv \"$tmp\" {staging_app}/.env.local; "
                f"done < {remote_env_override}; "
                f"fi; "
                f"cp {remote_build_info} {staging_app}/DEPLOYED_REVISION.json; "
                f"ls -la {staging_app}'"
            ),
            timeout=300,
        )

        print("=== npm ci ===")
        run(
            ssh,
            f"bash -lc 'cd {staging_app} && npm ci --no-fund --no-audit'",
            timeout=1800,
        )

        print("=== build hub ===")
        run(
            ssh,
            f"bash -lc 'cd {staging_app} && npm run build --workspace=packages/hub'",
            timeout=1800,
        )

        print("=== build dashboard ===")
        run(
            ssh,
            f"bash -lc 'cd {staging_app} && npm run build --workspace=packages/dashboard'",
            timeout=1800,
        )

        print("=== cutover ===")
        cutover_attempted = True
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                "pm2 delete clarix-hub || true; "
                f"rm -rf {previous_app}; "
                f"if [ -d {args.remote_app} ]; then mv {args.remote_app} {previous_app}; fi; "
                f"mv {staging_app} {args.remote_app}; "
                f"cd {args.remote_app} && "
                "pm2 start packages/hub/dist/index.js --name clarix-hub --update-env && "
                "pm2 save && "
                "systemctl reload caddy'"
            ),
            timeout=300,
        )

        print("=== verify live version ===")
        run(
            ssh,
            (
                "bash -lc 'set -e; "
                "for i in $(seq 1 30); do "
                "BODY=$(curl -fsS http://localhost:3001/api/version || true); "
                f"if echo \"$BODY\" | grep -q \"{archive_sha256}\"; then echo \"$BODY\"; exit 0; fi; "
                "sleep 2; "
                "done; "
                "echo \"Timed out waiting for expected build metadata\"; "
                "exit 1'"
            ),
            timeout=120,
        )

        print("=== final status ===")
        run(
            ssh,
            (
                "bash -lc '"
                "pm2 status --no-color && "
                "systemctl is-active caddy && "
                f"cat {args.remote_app}/DEPLOYED_REVISION.json && "
                f"ls -la {args.remote_app}/packages/dashboard/dist | head'"
            ),
            timeout=300,
        )

        deploy_succeeded = True
        print("=== cleanup old release ===")
        run(
            ssh,
            f"bash -lc 'rm -rf {previous_app} {backup_root}'",
            timeout=300,
        )
    except Exception:
        if cutover_attempted and not deploy_succeeded:
            print("=== rollback ===")
            try:
                run(
                    ssh,
                    (
                        "bash -lc 'set -e; "
                        "pm2 delete clarix-hub || true; "
                        f"rm -rf {failed_app}; "
                        f"if [ -d {args.remote_app} ]; then mv {args.remote_app} {failed_app}; fi; "
                        f"if [ -d {previous_app} ]; then mv {previous_app} {args.remote_app}; fi; "
                        f"cd {args.remote_app} && "
                        "pm2 start packages/hub/dist/index.js --name clarix-hub --update-env && "
                        "pm2 save && "
                        "systemctl reload caddy'"
                    ),
                    timeout=300,
                )
            except Exception as rollback_error:
                print(safe(f"Rollback failed: {rollback_error}"))
        raise
    finally:
        try:
            run(
                ssh,
                (
                    "bash -lc '"
                    f"rm -f {remote_archive} {remote_build_info} {remote_env_override} && "
                    f"rm -rf {staging_app}'"
                ),
                timeout=120,
            )
        except Exception as cleanup_error:
            print(safe(f"Cleanup warning: {cleanup_error}"))
        ssh.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
