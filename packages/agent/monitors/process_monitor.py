"""
Process and window presence monitor.
Works for both Insta Playout and Admax instances.
"""

import psutil
import win32gui
import win32process
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Dict, Deque

# Admax: allowlist of real playout executables (NOT admaxter.exe)
ADMAX_PROCESS_ALLOWLIST = {
    "admax-one playout2.0.exe",
    "admax-one playout2.0.2.exe",
    "noiretv_box_office_backup.exe",
    "noiretv_network_backup.exe",
}

INSTA_PROCESS_ALLOWLIST = {
    "insta playout.exe",
    "insta playout 2.exe",
}

# Rolling window for restart event counting (15 minutes)
_restart_events: Dict[str, Deque[datetime]] = {}
_last_process_up: Dict[str, bool] = {}


def _get_playout_process(playout_type: str):
    """Return the first matching playout process, or None."""
    allowlist = ADMAX_PROCESS_ALLOWLIST if playout_type == "admax" else INSTA_PROCESS_ALLOWLIST
    for proc in psutil.process_iter(["name", "pid"]):
        try:
            name = proc.info["name"].lower()
            if name in allowlist:
                return proc
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


def _check_window_exists(pid: int) -> bool:
    """Check if the process has a visible main window."""
    result = [False]

    def enum_cb(hwnd, _):
        try:
            _, found_pid = win32process.GetWindowThreadProcessId(hwnd)
            if found_pid == pid and win32gui.IsWindowVisible(hwnd):
                if win32gui.GetWindowText(hwnd):
                    result[0] = True
        except Exception:
            pass

    win32gui.EnumWindows(enum_cb, None)
    return result[0]


def check(instance_id: str, playout_type: str) -> dict:
    """
    Returns:
        playout_process_up: 1 or 0
        playout_window_up: 1 or 0
        restart_events_15m: count of restart events in last 15 minutes
    """
    proc = _get_playout_process(playout_type)
    process_up = proc is not None

    # Track restart events (transition from up→down→up)
    if instance_id not in _restart_events:
        _restart_events[instance_id] = deque()
    if instance_id not in _last_process_up:
        _last_process_up[instance_id] = process_up

    was_up = _last_process_up[instance_id]
    if not was_up and process_up:
        # Process came back — count as a restart event
        _restart_events[instance_id].append(datetime.now())

    _last_process_up[instance_id] = process_up

    # Purge events older than 15 minutes
    cutoff = datetime.now() - timedelta(minutes=15)
    while _restart_events[instance_id] and _restart_events[instance_id][0] < cutoff:
        _restart_events[instance_id].popleft()

    restart_count = len(_restart_events[instance_id])

    # Window check (only if process is up)
    window_up = False
    if process_up and proc:
        try:
            window_up = _check_window_exists(proc.pid)
        except Exception:
            window_up = False

    return {
        "playout_process_up": 1 if process_up else 0,
        "playout_window_up": 1 if window_up else 0,
        "restart_events_15m": restart_count,
    }
