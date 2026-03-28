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
from playout_profiles import playout_family

# Track previous position values for delta computation
_prev_position: Dict[str, float] = {}
_prev_position_30s_ts: Dict[str, datetime] = {}
_prev_position_60s: Dict[str, float] = {}
_prev_position_60s_ts: Dict[str, datetime] = {}
_prev_position_poll: Dict[str, float] = {}
_prev_file_mtime: Dict[str, float] = {}

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


def _read_insta_runtime_status(instance_root: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """Read Insta runningstatus.txt and return inferred runtime flags."""
    path = os.path.join(instance_root, "runningstatus.txt")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw_value = f.read().strip()
    except OSError:
        return None, None, None

    if not raw_value:
        return None, None, None

    parts = [part.strip() for part in raw_value.split("|")]
    if len(parts) < 2:
        return None, None, raw_value

    try:
        running_flag = int(parts[0])
        pause_flag = int(parts[1])
    except ValueError:
        return None, None, raw_value

    return running_flag, pause_flag, raw_value


def _resolve_insta_mainplaylist_path(instance_root: str) -> str:
    candidates = [
        os.path.join(instance_root, "Mainplaylist.xml"),
        os.path.join(instance_root, "MainplaylistOrig.xml"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return ""


def _compute_file_change(instance_key: str, path: str) -> Optional[int]:
    if not path or not os.path.exists(path):
        _prev_file_mtime.pop(instance_key, None)
        return None

    try:
        current_mtime = os.path.getmtime(path)
    except OSError:
        return None

    previous_mtime = _prev_file_mtime.get(instance_key)
    _prev_file_mtime[instance_key] = current_mtime
    if previous_mtime is None:
        return None
    return 1 if current_mtime > previous_mtime else 0


def _is_file_newer(left_path: str, right_path: str) -> Optional[int]:
    if (
        not left_path
        or not right_path
        or not os.path.exists(left_path)
        or not os.path.exists(right_path)
    ):
        return None

    try:
        return 1 if os.path.getmtime(left_path) > os.path.getmtime(right_path) else 0
    except OSError:
        return None


def _classify_insta_runtime_state(
    running_flag: Optional[int], pause_flag: Optional[int]
) -> Optional[str]:
    """
    Infer current Insta runtime state from runningstatus.txt.

    This mapping is intentionally conservative:
    - running flag 0 is treated as stopped
    - pause flag wins only when running is not stopped
    - positive running values are exposed as raw diagnostics only, because some
      Insta installs keep reporting non-zero values even while playback is
      paused or stopped
    """
    if running_flag == 0:
        return "stopped"
    if pause_flag == 1:
        return "paused"
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


def _compute_delta(instance_id: str, current_value: float) -> Tuple[Optional[float], float, float]:
    """
    Return (delta_30s, delta_60s) — change in position value over last ~30s and ~60s.
    Returns 0 if position is unchanged (stall indicator).
    """
    now = datetime.now()
    prev_poll_value = _prev_position_poll.get(instance_id)
    delta_poll = None if prev_poll_value is None else abs(current_value - prev_poll_value)
    _prev_position_poll[instance_id] = current_value
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

    return delta_poll, delta_30s, delta_60s


def check(instance_id: str, playout_type: str, paths: dict) -> dict:
    """
    Returns:
        filebar_position_delta_30s / frame_delta_30s: float (0 = stalled)
        filebar_position_delta_60s / frame_delta_60s: float
        fnf_new_entries: int
        playlistscan_new_entries: int
    """
    result: dict = {}
    family = playout_family(playout_type)

    if family == "insta":
        instance_root = paths.get("instance_root", "")
        mainplaylist_path = _resolve_insta_mainplaylist_path(instance_root)
        running_flag, pause_flag, raw_status = _read_insta_runtime_status(instance_root)
        runtime_state = _classify_insta_runtime_state(running_flag, pause_flag)
        if runtime_state:
            result["insta_runtime_state"] = runtime_state
        if running_flag is not None:
            result["insta_running_flag"] = running_flag
        if pause_flag is not None:
            result["insta_pause_flag"] = pause_flag
        if raw_status:
            result["insta_runningstatus_raw"] = raw_status

        mainplaylist_changed = _compute_file_change(
            f"{instance_id}_mainplaylist",
            mainplaylist_path,
        )
        if mainplaylist_changed is not None:
            result["insta_mainplaylist_changed_poll"] = mainplaylist_changed

        mainplaylist_newer_than_log = _is_file_newer(
            mainplaylist_path,
            _resolve_daily_log_path(paths.get("shared_log_dir", "")),
        )
        if mainplaylist_newer_than_log is not None:
            result["insta_mainplaylist_newer_than_log"] = mainplaylist_newer_than_log

        position = _read_filebar(instance_root)
        if position is not None:
            dpoll, d30, d60 = _compute_delta(instance_id, position)
            if dpoll is not None:
                result["filebar_position_delta_poll"] = round(dpoll, 3)
            result["filebar_position_delta_30s"] = round(d30, 3)
            result["filebar_position_delta_60s"] = round(d60, 3)
    elif family == "admax":
        frame = _read_admax_frame(paths)
        if frame is not None:
            dpoll, d30, d60 = _compute_delta(instance_id, float(frame))
            if dpoll is not None:
                result["frame_delta_poll"] = round(dpoll, 3)
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
