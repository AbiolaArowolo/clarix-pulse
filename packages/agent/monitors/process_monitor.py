"""
Process and window presence monitor.
Supports per-player selectors so same-type players on one node can be differentiated.
"""

from __future__ import annotations

import re
from collections import deque
from datetime import datetime, timedelta
from typing import Deque, Dict, Iterable

import psutil
import win32gui
import win32process
from playout_profiles import playout_family

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

_restart_events: Dict[str, Deque[datetime]] = {}
_last_process_up: Dict[str, bool] = {}
_prev_cpu_total: Dict[str, float] = {}
_prev_cpu_ts: Dict[str, datetime] = {}
_SERVICE_SELECTOR_KEYS = {
    "service_name",
    "service_names",
    "service_name_regex",
    "service_name_regexes",
    "service_display_name",
    "service_display_name_contains",
    "service_display_name_regex",
    "service_display_name_regexes",
    "service_path_contains",
    "service_path_regex",
}


def _as_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item]
    return []


def _default_process_names(playout_type: str) -> set[str]:
    family = playout_family(playout_type)
    if family == "admax":
        return ADMAX_PROCESS_ALLOWLIST
    if family == "insta":
        return INSTA_PROCESS_ALLOWLIST
    return set()


def _as_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " ".join(str(item) for item in value if item)
    return str(value)


def _matches_process(name: str, selectors: dict, playout_type: str) -> bool:
    process_names = {value.lower() for value in _as_list(selectors.get("process_names"))}
    process_name = str(selectors.get("process_name", "")).strip().lower()
    if process_name:
        process_names.add(process_name)

    if process_names:
        if name not in process_names:
            return False
    elif name not in _default_process_names(playout_type):
        return False

    regexes = [re.compile(pattern, re.IGNORECASE) for pattern in _as_list(selectors.get("process_name_regexes"))]
    single_regex = str(selectors.get("process_name_regex", "")).strip()
    if single_regex:
        regexes.append(re.compile(single_regex, re.IGNORECASE))
    if regexes and not any(regex.search(name) for regex in regexes):
        return False

    return True


def _matches_process_metadata(metadata: dict, selectors: dict, playout_type: str) -> bool:
    name = _as_text(metadata.get("name")).strip().lower()
    if not name or not _matches_process(name, selectors, playout_type):
        return False

    executable_path = _as_text(metadata.get("executable_path")).strip()
    executable_path_lower = executable_path.lower()
    executable_contains = [value.lower() for value in _as_list(selectors.get("executable_path_contains"))]
    if executable_contains and not any(value in executable_path_lower for value in executable_contains):
        return False

    executable_regex = str(selectors.get("executable_path_regex", "")).strip()
    if executable_regex and not re.search(executable_regex, executable_path, re.IGNORECASE):
        return False

    command_line = _as_text(metadata.get("command_line")).strip()
    command_line_lower = command_line.lower()
    command_contains = [value.lower() for value in _as_list(selectors.get("command_line_contains"))]
    if command_contains and not any(value in command_line_lower for value in command_contains):
        return False

    command_regex = str(selectors.get("command_line_regex", "")).strip()
    if command_regex and not re.search(command_regex, command_line, re.IGNORECASE):
        return False

    return True


def _has_service_selectors(selectors: dict) -> bool:
    for key in _SERVICE_SELECTOR_KEYS:
        value = selectors.get(key)
        if isinstance(value, (list, tuple, set)):
            if any(str(item).strip() for item in value if item is not None):
                return True
            continue
        if _as_text(value).strip():
            return True
    return False


def _matches_service_metadata(metadata: dict, selectors: dict) -> bool:
    service_name = _as_text(metadata.get("name")).strip().lower()
    if not service_name:
        return False

    configured_names = {value.lower() for value in _as_list(selectors.get("service_names"))}
    single_name = _as_text(selectors.get("service_name")).strip().lower()
    if single_name:
        configured_names.add(single_name)
    if configured_names and service_name not in configured_names:
        return False

    name_regexes = [re.compile(pattern, re.IGNORECASE) for pattern in _as_list(selectors.get("service_name_regexes"))]
    single_name_regex = _as_text(selectors.get("service_name_regex")).strip()
    if single_name_regex:
        name_regexes.append(re.compile(single_name_regex, re.IGNORECASE))
    if name_regexes and not any(regex.search(service_name) for regex in name_regexes):
        return False

    display_name = _as_text(metadata.get("display_name")).strip()
    display_name_lower = display_name.lower()
    display_contains = [value.lower() for value in _as_list(selectors.get("service_display_name_contains"))]
    single_display = _as_text(selectors.get("service_display_name")).strip().lower()
    if single_display:
        display_contains.append(single_display)
    if display_contains and not any(value in display_name_lower for value in display_contains):
        return False

    display_regexes = [re.compile(pattern, re.IGNORECASE) for pattern in _as_list(selectors.get("service_display_name_regexes"))]
    single_display_regex = _as_text(selectors.get("service_display_name_regex")).strip()
    if single_display_regex:
        display_regexes.append(re.compile(single_display_regex, re.IGNORECASE))
    if display_regexes and not any(regex.search(display_name) for regex in display_regexes):
        return False

    service_path = _as_text(metadata.get("path") or metadata.get("binpath")).strip()
    service_path_lower = service_path.lower()
    path_contains = [value.lower() for value in _as_list(selectors.get("service_path_contains"))]
    if path_contains and not any(value in service_path_lower for value in path_contains):
        return False

    path_regex = _as_text(selectors.get("service_path_regex")).strip()
    if path_regex and not re.search(path_regex, service_path, re.IGNORECASE):
        return False

    return True


def _iter_matching_processes(playout_type: str, selectors: dict) -> Iterable[psutil.Process]:
    for proc in psutil.process_iter(["name", "pid", "exe", "cmdline"]):
        try:
            metadata = {
                "name": proc.info.get("name"),
                "executable_path": proc.info.get("exe"),
                "command_line": proc.info.get("cmdline"),
            }
            if _matches_process_metadata(metadata, selectors, playout_type):
                yield proc
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue


def _service_running(metadata: dict) -> bool:
    status = _as_text(metadata.get("status")).strip().lower()
    if status:
        return status == "running"

    started = metadata.get("started")
    if isinstance(started, bool):
        return started

    try:
        return int(metadata.get("pid") or 0) > 0
    except (TypeError, ValueError):
        return False


def _read_service_metadata(service: object) -> dict:
    info = {}
    try:
        info = service.as_dict()
    except Exception:
        info = {}

    def _call(name: str) -> object:
        attr = getattr(service, name, None)
        if callable(attr):
            try:
                return attr()
            except Exception:
                return None
        return attr

    return {
        "name": info.get("name") or _call("name"),
        "display_name": info.get("display_name") or _call("display_name"),
        "path": info.get("binpath") or _call("binpath"),
        "status": info.get("status") or _call("status"),
        "pid": info.get("pid") or _call("pid"),
        "started": info.get("started"),
    }


def _iter_matching_services(selectors: dict) -> Iterable[dict]:
    if not _has_service_selectors(selectors) or not hasattr(psutil, "win_service_iter"):
        return

    try:
        services = psutil.win_service_iter()
    except Exception:
        return

    for service in services:
        try:
            metadata = _read_service_metadata(service)
            if _matches_service_metadata(metadata, selectors):
                yield metadata
        except Exception:
            continue


def _window_matches(title: str, selectors: dict) -> bool:
    contains = [value.lower() for value in _as_list(selectors.get("window_title_contains"))]
    single_contains = str(selectors.get("window_title", "")).strip().lower()
    if single_contains:
        contains.append(single_contains)

    if contains and not any(part in title.lower() for part in contains):
        return False

    regexes = [re.compile(pattern, re.IGNORECASE) for pattern in _as_list(selectors.get("window_title_regexes"))]
    single_regex = str(selectors.get("window_title_regex", "")).strip()
    if single_regex:
        regexes.append(re.compile(single_regex, re.IGNORECASE))
    if regexes and not any(regex.search(title) for regex in regexes):
        return False

    return True


def _check_window_exists(pid: int, selectors: dict) -> bool:
    result = [False]

    def enum_cb(hwnd, _):
        try:
            _, found_pid = win32process.GetWindowThreadProcessId(hwnd)
            if found_pid != pid or not win32gui.IsWindowVisible(hwnd):
                return

            title = win32gui.GetWindowText(hwnd)
            if not title:
                return

            if _window_matches(title, selectors):
                result[0] = True
        except Exception:
            pass

    win32gui.EnumWindows(enum_cb, None)
    return result[0]


def _total_cpu_seconds(processes: list[psutil.Process]) -> float | None:
    total = 0.0
    found = False
    for proc in processes:
        try:
            cpu_times = proc.cpu_times()
            total += float(cpu_times.user) + float(cpu_times.system)
            found = True
        except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
            continue

    if not found:
        return None

    return total


def check(instance_id: str, playout_type: str, selectors: dict | None = None) -> dict:
    selectors = selectors or {}
    matching_processes = list(_iter_matching_processes(playout_type, selectors))
    matching_services = list(_iter_matching_services(selectors))
    service_up = any(_service_running(metadata) for metadata in matching_services)
    process_up = len(matching_processes) > 0 or service_up

    if instance_id not in _restart_events:
        _restart_events[instance_id] = deque()
    if instance_id not in _last_process_up:
        _last_process_up[instance_id] = process_up

    was_up = _last_process_up[instance_id]
    if not was_up and process_up:
        _restart_events[instance_id].append(datetime.now())

    _last_process_up[instance_id] = process_up

    cutoff = datetime.now() - timedelta(minutes=15)
    while _restart_events[instance_id] and _restart_events[instance_id][0] < cutoff:
        _restart_events[instance_id].popleft()

    restart_count = len(_restart_events[instance_id])
    window_up = False
    cpu_usage_ratio_poll = None

    now = datetime.now()
    current_cpu_total = _total_cpu_seconds(matching_processes) if process_up else None
    previous_cpu_total = _prev_cpu_total.get(instance_id)
    previous_cpu_ts = _prev_cpu_ts.get(instance_id)
    if current_cpu_total is not None:
        if previous_cpu_total is not None and previous_cpu_ts is not None:
            elapsed_seconds = max(0.001, (now - previous_cpu_ts).total_seconds())
            cpu_delta = max(0.0, current_cpu_total - previous_cpu_total)
            cpu_usage_ratio_poll = cpu_delta / elapsed_seconds
        _prev_cpu_total[instance_id] = current_cpu_total
        _prev_cpu_ts[instance_id] = now
    else:
        _prev_cpu_total.pop(instance_id, None)
        _prev_cpu_ts.pop(instance_id, None)

    if process_up:
        for proc in matching_processes:
            try:
                if _check_window_exists(proc.pid, selectors):
                    window_up = True
                    break
            except Exception:
                continue

    return {
        "playout_process_up": 1 if process_up else 0,
        "playout_service_up": 1 if service_up else 0,
        "playout_window_up": 1 if window_up else 0,
        "restart_events_15m": restart_count,
        "playout_cpu_usage_ratio_poll": round(cpu_usage_ratio_poll, 3) if cpu_usage_ratio_poll is not None else None,
    }
