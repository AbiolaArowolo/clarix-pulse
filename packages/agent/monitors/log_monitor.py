"""
Deep log monitoring with optional per-player filters.
Shared logs can be narrowed to the correct player via include/exclude selectors.
"""

from __future__ import annotations

import os
import re
from datetime import date
from typing import Dict, Iterable, Optional

_file_positions: Dict[str, int] = {}
_last_log_path: Dict[str, str] = {}

DEFAULT_PATTERNS = {
    "admax_paused": re.compile(r"stopxxx2", re.IGNORECASE),
    "admax_exited": re.compile(r"Application Exited by client", re.IGNORECASE),
    "admax_reinit": re.compile(r"(initializ|starting up|application start)", re.IGNORECASE),
    "insta_paused": re.compile(r"\bPaused\b", re.IGNORECASE),
    "insta_played": re.compile(r"Fully Played", re.IGNORECASE),
}


def _as_list(value: object) -> list[str]:
    if value is None:
      return []
    if isinstance(value, str):
      return [value]
    if isinstance(value, (list, tuple, set)):
      return [str(item) for item in value if item]
    return []


def _compile_patterns(values: Iterable[str]) -> list[re.Pattern[str]]:
    return [re.compile(value, re.IGNORECASE) for value in values if value]


def _get_log_path_insta(shared_log_dir: str) -> str:
    if not shared_log_dir:
        return ""
    if os.path.isfile(shared_log_dir):
        return shared_log_dir

    today = date.today().strftime("%d-%m-%Y")
    return os.path.join(shared_log_dir, f"{today}.txt")


def _get_log_path_admax(paths: dict) -> str:
    today = date.today().strftime("%Y-%m-%d")
    direct_hint = str(
        paths.get("playout_log_dir")
        or paths.get("admax_log_dir")
        or paths.get("log_dir")
        or ""
    ).strip()
    if direct_hint:
        if os.path.isfile(direct_hint):
            return direct_hint
        return os.path.join(direct_hint, f"{today}.txt")

    admax_root = str(paths.get("admax_root", "")).strip()
    candidate_dirs = [
        os.path.join(admax_root, "logs", "logs", "Playout"),
        os.path.join(admax_root, "logs", "Playout"),
        os.path.join(admax_root, "bin", "64bit", "logs", "logs", "Playout"),
        os.path.join(admax_root, "bin", "64bit", "logs", "Playout"),
    ]
    for candidate in candidate_dirs:
        if os.path.isdir(candidate):
            return os.path.join(candidate, f"{today}.txt")

    return os.path.join(admax_root, "logs", "logs", "Playout", f"{today}.txt")


def _read_new_lines(path: str, instance_id: str) -> list[str]:
    if not os.path.exists(path):
        _file_positions.pop(instance_id, None)
        _last_log_path.pop(instance_id, None)
        return []

    file_size = os.path.getsize(path)
    if path != _last_log_path.get(instance_id):
        _last_log_path[instance_id] = path
        _file_positions[instance_id] = file_size
        return []

    if instance_id not in _file_positions:
        _file_positions[instance_id] = file_size
        return []

    last_pos = _file_positions.get(instance_id, 0)

    if file_size < last_pos:
        last_pos = 0

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            handle.seek(last_pos)
            new_content = handle.read()
            _file_positions[instance_id] = handle.tell()
        return new_content.splitlines()
    except (OSError, IOError):
        return []


def _line_matches(line: str, selectors: dict) -> bool:
    include_contains = [value.lower() for value in _as_list(selectors.get("include_contains"))]
    exclude_contains = [value.lower() for value in _as_list(selectors.get("exclude_contains"))]
    include_regexes = _compile_patterns(_as_list(selectors.get("include_regexes")))
    exclude_regexes = _compile_patterns(_as_list(selectors.get("exclude_regexes")))

    lowered = line.lower()
    if include_contains and not any(token in lowered for token in include_contains):
        return False
    if include_regexes and not any(regex.search(line) for regex in include_regexes):
        return False
    if any(token in lowered for token in exclude_contains):
        return False
    if any(regex.search(line) for regex in exclude_regexes):
        return False
    return True


def _select_lines(lines: list[str], selectors: dict) -> list[str]:
    if not selectors:
        return lines
    return [line for line in lines if _line_matches(line, selectors)]


def _pattern(selectors: dict, key: str, default_key: str) -> re.Pattern[str]:
    direct = str(selectors.get(f"{key}_regex", "")).strip()
    token_patterns = selectors.get("token_patterns", {}) or {}
    nested = str(token_patterns.get(key, "")).strip() if isinstance(token_patterns, dict) else ""
    if nested:
        return re.compile(nested, re.IGNORECASE)
    if direct:
        return re.compile(direct, re.IGNORECASE)
    return DEFAULT_PATTERNS[default_key]


def _classify_admax_lines(lines: list[str], selectors: dict) -> Optional[str]:
    paused = _pattern(selectors, "paused", "admax_paused")
    exited = _pattern(selectors, "exited", "admax_exited")
    reinit = _pattern(selectors, "reinit", "admax_reinit")

    token = None
    for line in lines:
        if exited.search(line):
            return "app_exited"
        if paused.search(line):
            token = "stopxxx2"
        elif reinit.search(line) and token != "stopxxx2":
            token = "reinit"
    return token


def _classify_insta_lines(lines: list[str], selectors: dict) -> Optional[str]:
    paused = _pattern(selectors, "paused", "insta_paused")
    played = _pattern(selectors, "played", "insta_played")

    token = None
    for line in lines:
        if paused.search(line):
            token = "paused"
        elif played.search(line) and token != "paused":
            token = "fully_played"
    return token


def check(instance_id: str, playout_type: str, paths: dict, selectors: dict | None = None) -> dict:
    selectors = selectors or {}

    if playout_type == "admax":
        log_path = _get_log_path_admax(paths)
    else:
        log_path = _get_log_path_insta(paths.get("shared_log_dir", ""))

    log_exists = os.path.exists(log_path)
    new_lines = _select_lines(_read_new_lines(log_path, instance_id), selectors)

    if playout_type == "admax":
        token = _classify_admax_lines(new_lines, selectors)
    else:
        token = _classify_insta_lines(new_lines, selectors)

    return {
        "log_last_token": token,
        "log_path_exists": 1 if log_exists else 0,
    }
