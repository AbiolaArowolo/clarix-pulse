"""
Deep log monitoring — validated primary signal for both Insta Playout and Admax.
Tails new lines since last poll, detects state transition tokens.
"""

import os
import re
from datetime import date
from typing import Dict, Optional, Tuple

# Track file position per instance to only read new lines
_file_positions: Dict[str, int] = {}
_last_log_path: Dict[str, str] = {}


def _get_log_path_insta(shared_log_dir: str) -> str:
    """Insta Playout: shared log named by today's date."""
    today = date.today().strftime("%d-%m-%Y")
    return os.path.join(shared_log_dir, f"{today}.txt")


def _get_log_path_admax(admax_root: str) -> str:
    """Admax: playout log named by today's date."""
    today = date.today().strftime("%Y-%m-%d")
    return os.path.join(admax_root, "logs", "logs", "Playout", f"{today}.txt")


def _read_new_lines(path: str, instance_id: str) -> list[str]:
    """Read only new lines added since last poll. Handles file rotation."""
    if not os.path.exists(path):
        _file_positions.pop(instance_id, None)
        return []

    # Detect file rotation (new file smaller than remembered position)
    file_size = os.path.getsize(path)
    last_pos = _file_positions.get(instance_id, 0)
    if path != _last_log_path.get(instance_id):
        last_pos = 0  # new day, new file
        _last_log_path[instance_id] = path

    if file_size < last_pos:
        last_pos = 0  # file was rotated/truncated

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(last_pos)
            new_content = f.read()
            _file_positions[instance_id] = f.tell()
        return new_content.splitlines()
    except (OSError, IOError):
        return []


# ─── Token patterns ───────────────────────────────────────────────────────────

# Admax tokens
ADMAX_PAUSED_RE = re.compile(r"stopxxx2", re.IGNORECASE)
ADMAX_EXITED_RE = re.compile(r"Application Exited by client", re.IGNORECASE)
ADMAX_REINIT_RE = re.compile(r"(initializ|starting up|application start)", re.IGNORECASE)

# Insta tokens
INSTA_PAUSED_RE = re.compile(r"\bPaused\b", re.IGNORECASE)
INSTA_PLAYED_RE = re.compile(r"Fully Played", re.IGNORECASE)


def _classify_admax_lines(lines: list[str]) -> Optional[str]:
    """Return the most significant token found in new Admax log lines."""
    token = None
    for line in lines:
        if ADMAX_EXITED_RE.search(line):
            return "app_exited"  # highest priority
        if ADMAX_PAUSED_RE.search(line):
            token = "stopxxx2"
        elif ADMAX_REINIT_RE.search(line) and token != "stopxxx2":
            token = "reinit"
    return token


def _classify_insta_lines(lines: list[str]) -> Optional[str]:
    """Return the most significant token found in new Insta log lines."""
    token = None
    for line in lines:
        if INSTA_PAUSED_RE.search(line):
            token = "paused"
        elif INSTA_PLAYED_RE.search(line) and token != "paused":
            token = "fully_played"
    return token


def check(instance_id: str, playout_type: str, paths: dict) -> dict:
    """
    Returns:
        log_last_token: str | None — most recent significant log token
        log_path_exists: 1 or 0
    """
    if playout_type == "admax":
        log_path = _get_log_path_admax(paths.get("admax_root", ""))
    else:
        log_path = _get_log_path_insta(paths.get("shared_log_dir", ""))

    log_exists = os.path.exists(log_path)
    new_lines = _read_new_lines(log_path, instance_id)

    if playout_type == "admax":
        token = _classify_admax_lines(new_lines)
    else:
        token = _classify_insta_lines(new_lines)

    return {
        "log_last_token": token,
        "log_path_exists": 1 if log_exists else 0,
    }
