"""
File state monitoring — stall detection and content error detection.

Insta: filebar.txt FilePosition delta (stall), FNF/playlistscan logs (content error)
Admax: Settings.ini Frame delta (stall), FNF/playlistscan logs (content error)
"""

import os
import json
import re
import configparser
from datetime import datetime, date
from typing import Dict, Optional, Tuple

# Track previous position values for delta computation
_prev_position: Dict[str, float] = {}
_prev_position_30s_ts: Dict[str, datetime] = {}
_prev_position_60s: Dict[str, float] = {}
_prev_position_60s_ts: Dict[str, datetime] = {}

# Track last seen line count for content error logs
_last_fnf_size: Dict[str, int] = {}
_last_playlistscan_size: Dict[str, int] = {}


def _read_filebar(instance_root: str) -> Optional[float]:
    """Read Insta filebar.txt and return FilePosition value."""
    path = os.path.join(instance_root, "filebar.txt")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = json.load(f)
        return float(data.get("FilePosition", 0))
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def _read_admax_frame(paths: dict) -> Optional[int]:
    """Read Admax Settings.ini and return Frame value."""
    candidates = []
    direct_path = str(paths.get("admax_state_path", "")).strip()
    if direct_path:
        candidates.append(direct_path)

    admax_root = str(paths.get("admax_root", "")).strip()
    if admax_root:
        candidates.extend(
            [
                os.path.join(admax_root, "Settings.ini"),
                os.path.join(admax_root, "bin", "Settings.ini"),
                os.path.join(admax_root, "bin", "64bit", "Settings.ini"),
            ]
        )

    for path in candidates:
        if not path or not os.path.exists(path):
            continue
        try:
            config = configparser.ConfigParser()
            config.read(path, encoding="utf-8")
            for section in config.sections():
                if config.has_option(section, "Frame"):
                    return int(config.get(section, "Frame"))
        except (OSError, configparser.Error, ValueError):
            continue

    return None


def _resolve_daily_log_path(path_hint: str) -> str:
    if not path_hint:
        return ""
    if os.path.isdir(path_hint):
        today = date.today().strftime("%d-%m-%Y")
        return os.path.join(path_hint, f"{today}.txt")
    return path_hint


def _new_log_entries(path: str, instance_key: str, cache: Dict[str, int]) -> int:
    """Return number of new lines since last check."""
    path = _resolve_daily_log_path(path)
    if not path or not os.path.exists(path):
        return 0
    try:
        size = os.path.getsize(path)
        prev = cache.get(instance_key, size)  # first run: no new entries
        cache[instance_key] = size
        return max(0, size - prev)
    except OSError:
        return 0


def _compute_delta(instance_id: str, current_value: float) -> Tuple[float, float]:
    """
    Return (delta_30s, delta_60s) — change in position value over last ~30s and ~60s.
    Returns 0 if position is unchanged (stall indicator).
    """
    now = datetime.now()
    delta_30s = 1.0  # default: assume moving
    delta_60s = 1.0

    # 30s delta
    if instance_id in _prev_position:
        elapsed = (now - _prev_position_30s_ts[instance_id]).total_seconds()
        if elapsed >= 25:  # close enough to 30s
            delta_30s = abs(current_value - _prev_position[instance_id])
            _prev_position[instance_id] = current_value
            _prev_position_30s_ts[instance_id] = now
    else:
        _prev_position[instance_id] = current_value
        _prev_position_30s_ts[instance_id] = now

    # 60s delta
    if instance_id in _prev_position_60s:
        elapsed = (now - _prev_position_60s_ts[instance_id]).total_seconds()
        if elapsed >= 55:
            delta_60s = abs(current_value - _prev_position_60s[instance_id])
            _prev_position_60s[instance_id] = current_value
            _prev_position_60s_ts[instance_id] = now
    else:
        _prev_position_60s[instance_id] = current_value
        _prev_position_60s_ts[instance_id] = now

    return delta_30s, delta_60s


def check(instance_id: str, playout_type: str, paths: dict) -> dict:
    """
    Returns:
        filebar_position_delta_30s / frame_delta_30s: float (0 = stalled)
        filebar_position_delta_60s / frame_delta_60s: float
        fnf_new_entries: int
        playlistscan_new_entries: int
    """
    result: dict = {}

    if playout_type == "insta":
        instance_root = paths.get("instance_root", "")
        position = _read_filebar(instance_root)
        if position is not None:
            d30, d60 = _compute_delta(instance_id, position)
            result["filebar_position_delta_30s"] = round(d30, 3)
            result["filebar_position_delta_60s"] = round(d60, 3)
    else:
        frame = _read_admax_frame(paths)
        if frame is not None:
            d30, d60 = _compute_delta(instance_id, float(frame))
            result["frame_delta_30s"] = round(d30, 3)
            result["frame_delta_60s"] = round(d60, 3)

    # Content error detection
    fnf_key = f"{instance_id}_fnf"
    ps_key = f"{instance_id}_ps"
    result["fnf_new_entries"] = _new_log_entries(
        paths.get("fnf_log", ""), fnf_key, _last_fnf_size
    )
    result["playlistscan_new_entries"] = _new_log_entries(
        paths.get("playlistscan_log", ""), ps_key, _last_playlistscan_size
    )

    return result
