"""
Connectivity monitoring.

gateway_up: pings the machine's default gateway (local LAN reachability)
internet_up: pings 1.1.1.1 and 8.8.8.8 (public internet reachability)

These are deliberately separate — gateway can be up while internet is down.
"""

import subprocess
import socket
import platform


def _ping(host: str, timeout: int = 1) -> bool:
    """Ping a host, return True if reachable."""
    param = "-n" if platform.system().lower() == "windows" else "-c"
    try:
        result = subprocess.run(
            ["ping", param, "1", "-w", str(timeout * 1000), host],
            capture_output=True,
            timeout=timeout + 1,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def _get_default_gateway() -> str | None:
    """Get the default gateway IP on Windows."""
    try:
        result = subprocess.run(
            ["ipconfig"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if "Default Gateway" in line:
                parts = line.split(":")
                if len(parts) >= 2:
                    gw = parts[-1].strip()
                    if gw and gw != "":
                        return gw
    except Exception:
        pass
    return None


def check() -> dict:
    """
    Returns:
        gateway_up: 1 or 0
        internet_up: 1 or 0
    """
    gateway = _get_default_gateway()
    gateway_up = _ping(gateway) if gateway else False

    # Check two public DNS servers — up if either responds
    internet_up = _ping("1.1.1.1") or _ping("8.8.8.8")

    return {
        "gateway_up": 1 if gateway_up else 0,
        "internet_up": 1 if internet_up else 0,
    }
