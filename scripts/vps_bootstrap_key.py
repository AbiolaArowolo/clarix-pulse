"""One-time bootstrap: authorize a new public key on the Pulse VPS.

Runs over the existing password auth (from CI secrets) to append a public
key to /root/.ssh/authorized_keys, so future access can be key-only.
Idempotent - skips if the key is already present.
"""

from __future__ import annotations

import os

import paramiko

PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGvqWU1cAfUqet4Mrep+TpIJOCVNchsv8jA7NGijIwIx claude-code-pulse-vps"


def main() -> int:
    host = os.environ.get("VPS_HOST")
    user = os.environ.get("VPS_USER")
    password = os.environ.get("VPS_ROOT_PASSWORD")
    if not host or not user or not password:
        raise SystemExit("VPS_HOST, VPS_USER, VPS_ROOT_PASSWORD must be set.")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=host, username=user, password=password, timeout=20)

    try:
        cmd = (
            "bash -lc '"
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && "
            f"grep -qxF \"{PUBLIC_KEY}\" ~/.ssh/authorized_keys || "
            f"echo \"{PUBLIC_KEY}\" >> ~/.ssh/authorized_keys; "
            "echo DONE'"
        )
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode()
        err = stderr.read().decode()
        print(out)
        if err:
            print(err)
        if "DONE" not in out:
            raise SystemExit("Bootstrap did not complete as expected.")
        print("Key authorized (or already present). Key-based access is now live.")
    finally:
        ssh.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
