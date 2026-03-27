"""
Pulse - Local Monitoring Agent.
Can run as a local installer/configurator in an interactive session and as a
monitoring loop when launched by the Windows service. Polls every N seconds,
POSTs one heartbeat per player to the hub. Sends raw observations only - hub
computes health state.
"""

import ctypes
import json
import os
import sys
import time
import glob
import logging
import shutil
import socket
import subprocess
import tempfile
import traceback
import zipfile
from datetime import datetime
from typing import Any

import yaml
import requests
import psutil

from monitors import process_monitor, log_monitor, file_monitor, connectivity, udp_probe

# --- Logging ------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("clarix-agent.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("clarix-agent")

PROCESS_SELECTOR_KEYS = {
    "process_name",
    "process_names",
    "process_name_regex",
    "process_name_regexes",
    "window_title",
    "window_title_contains",
    "window_title_regex",
    "window_title_regexes",
}

LOG_SELECTOR_KEYS = {
    "include_contains",
    "exclude_contains",
    "include_regexes",
    "exclude_regexes",
    "paused_regex",
    "played_regex",
    "skipped_regex",
    "exited_regex",
    "reinit_regex",
    "token_patterns",
}

INSTALL_DIR = os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "ClarixPulse", "Agent")
SERVICE_NAME = "ClarixPulseAgent"
SERVICE_DISPLAY_NAME = "Pulse Agent"
DEFAULT_HUB_URL = "https://monitor.example.com"
DEFAULT_INSTA_LOG_DIR = r"C:\Program Files\Indytek\Insta log"
DEFAULT_INSTA_INSTANCE_ROOT = r"C:\Program Files\Indytek\Insta Playout\Settings"
NSSM_PACKAGE_URL = "https://community.chocolatey.org/api/v2/package/nssm"
FFMPEG_ARCHIVE_URL = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
    "ffmpeg-n8.0-latest-win64-gpl-8.0.zip"
)


# --- Config -------------------------------------------------------------------

def _as_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _as_int(value: Any, default: int) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value if item]
    return []


def _pick_keys(source: dict[str, Any], keys: set[str]) -> dict[str, Any]:
    return {key: source[key] for key in keys if key in source}


def _merge_mapping(target: dict[str, Any], source: Any) -> None:
    if isinstance(source, dict):
        target.update(source)


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        text = _as_str(value)
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(text)
    return deduped


def _expand_path_candidates(values: list[str]) -> list[str]:
    expanded: list[str] = []
    for value in _dedupe_strings(values):
        if any(token in value for token in "*?[]"):
            matches = sorted(glob.glob(value))
            if matches:
                expanded.extend(matches)
                continue
        expanded.append(value)
    return _dedupe_strings(expanded)


def _candidate_paths(paths: dict[str, Any], *keys: str) -> list[str]:
    values: list[str] = []
    for key in keys:
        raw_value = paths.get(key)
        if isinstance(raw_value, str):
            values.append(raw_value)
        elif isinstance(raw_value, (list, tuple, set)):
            values.extend(_as_list(raw_value))
    return _expand_path_candidates(values)


def _first_existing_dir(candidates: list[str]) -> str:
    for candidate in _expand_path_candidates(candidates):
        if os.path.isdir(candidate):
            return os.path.normpath(candidate)
    return ""


def _first_existing_file(candidates: list[str]) -> str:
    for candidate in _expand_path_candidates(candidates):
        if os.path.isfile(candidate):
            return os.path.normpath(candidate)
    return ""


def _score_admax_root(path: str) -> int:
    if not os.path.isdir(path):
        return -1

    score = 1
    marker_patterns = [
        os.path.join(path, "**", "Playout"),
        os.path.join(path, "**", "FNF"),
        os.path.join(path, "**", "playlistscan"),
        os.path.join(path, "**", "Settings.ini"),
    ]
    for pattern in marker_patterns:
        if glob.glob(pattern, recursive=True):
            score += 5
    return score


def _best_existing_dir(candidates: list[str]) -> str:
    best_path = ""
    best_score = -1
    for candidate in _expand_path_candidates(candidates):
        if not os.path.isdir(candidate):
            continue
        score = _score_admax_root(candidate)
        if score > best_score:
            best_path = os.path.normpath(candidate)
            best_score = score
    return best_path


def _default_admax_root_patterns() -> list[str]:
    patterns: list[str] = []
    for env_name, fallback in (
        ("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        ("ProgramFiles", r"C:\Program Files"),
    ):
        base_dir = os.environ.get(env_name, fallback)
        patterns.append(os.path.join(base_dir, "Unimedia", "Admax One*", "admax"))
        patterns.append(os.path.join(base_dir, "Unimedia", "Admax*", "admax"))
    return _dedupe_strings(patterns)


def _resolve_admax_paths(paths: dict[str, Any]) -> dict[str, Any]:
    explicit_root = _first_existing_dir(_candidate_paths(paths, "admax_root", "admax_root_candidates"))
    admax_root = explicit_root or _best_existing_dir(_default_admax_root_patterns())
    if admax_root:
        paths["admax_root"] = admax_root

    playout_dir_candidates = _candidate_paths(paths, "playout_log_dir", "admax_log_dir", "log_dir")
    fnf_candidates = _candidate_paths(paths, "fnf_log", "fnf_log_dir")
    playlistscan_candidates = _candidate_paths(paths, "playlistscan_log", "playlistscan_log_dir")
    settings_candidates = _candidate_paths(paths, "admax_state_path", "settings_ini", "settings_path")

    if admax_root:
        playout_dir_candidates.extend(
            [
                os.path.join(admax_root, "logs", "logs", "Playout"),
                os.path.join(admax_root, "logs", "Playout"),
                os.path.join(admax_root, "bin", "64bit", "logs", "logs", "Playout"),
                os.path.join(admax_root, "bin", "64bit", "logs", "Playout"),
            ]
        )
        fnf_candidates.extend(
            [
                os.path.join(admax_root, "logs", "FNF"),
                os.path.join(admax_root, "bin", "64bit", "logs", "FNF"),
            ]
        )
        playlistscan_candidates.extend(
            [
                os.path.join(admax_root, "logs", "playlistscan"),
                os.path.join(admax_root, "bin", "64bit", "logs", "playlistscan"),
            ]
        )
        settings_candidates.extend(
            [
                os.path.join(admax_root, "Settings.ini"),
                os.path.join(admax_root, "bin", "Settings.ini"),
                os.path.join(admax_root, "bin", "64bit", "Settings.ini"),
            ]
        )

        playout_dir_candidates.extend(glob.glob(os.path.join(admax_root, "**", "Playout"), recursive=True))
        fnf_candidates.extend(glob.glob(os.path.join(admax_root, "**", "FNF"), recursive=True))
        playlistscan_candidates.extend(glob.glob(os.path.join(admax_root, "**", "playlistscan"), recursive=True))
        settings_candidates.extend(glob.glob(os.path.join(admax_root, "**", "Settings.ini"), recursive=True))

    playout_log_dir = _first_existing_dir(playout_dir_candidates)
    if playout_log_dir:
        paths["playout_log_dir"] = playout_log_dir

    fnf_log = _first_existing_dir(fnf_candidates)
    if fnf_log:
        paths["fnf_log"] = fnf_log

    playlistscan_log = _first_existing_dir(playlistscan_candidates)
    if playlistscan_log:
        paths["playlistscan_log"] = playlistscan_log

    admax_state_path = _first_existing_file(settings_candidates)
    if admax_state_path:
        paths["admax_state_path"] = admax_state_path

    return paths


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(__file__)


def _current_executable_path() -> str:
    return sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)


def _load_raw_config(config_path: str | None = None) -> dict[str, Any]:
    resolved_path = config_path or os.path.join(_base_dir(), "config.yaml")
    if not os.path.exists(resolved_path):
        raise FileNotFoundError(f"config.yaml not found at {resolved_path}")

    with open(resolved_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if not isinstance(data, dict):
        raise ValueError("config.yaml must contain a mapping at the top level")

    return data


def _normalize_udp_input(player_id: str, udp_input: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(udp_input, dict):
        return None

    udp_input_id = _as_str(
        udp_input.get("udp_input_id")
        or udp_input.get("udpInputId")
        or udp_input.get("id")
        or udp_input.get("input_id")
        or f"{player_id}-udp-{index + 1}"
    )

    return {
        "udp_input_id": udp_input_id,
        "enabled": _as_bool(udp_input.get("enabled"), False),
        "stream_url": udp_probe.normalize_stream_url(
            udp_input.get("stream_url", udp_input.get("streamUrl"))
        ),
        "thumbnail_interval_s": _as_int(
            udp_input.get("thumbnail_interval_s", udp_input.get("thumbnailIntervalS")),
            10,
        ),
    }


def _normalize_paths(player: dict[str, Any], playout_type: str) -> dict[str, Any]:
    paths = _as_mapping(player.get("paths"))

    instance_root = _as_str(paths.get("instance_root"))
    if not instance_root:
        legacy_player_root = _as_str(paths.get("player_root"))
        if legacy_player_root:
            paths["instance_root"] = legacy_player_root

    admax_root = _as_str(paths.get("admax_root"))
    if not admax_root:
        log_dir = _as_str(paths.get("log_dir")).rstrip("\\/")
        if log_dir:
            derived_root = log_dir
            for _ in range(3):
                derived_root = os.path.dirname(derived_root)
            if derived_root:
                paths["admax_root"] = derived_root

    if playout_type == "admax":
        paths = _resolve_admax_paths(paths)

    return paths


def _normalize_process_selectors(player: dict[str, Any]) -> dict[str, Any]:
    selectors = _pick_keys(player, PROCESS_SELECTOR_KEYS)
    selector_root = _as_mapping(player.get("selectors"))
    _merge_mapping(selectors, selector_root.get("process"))
    _merge_mapping(selectors, player.get("process"))
    _merge_mapping(selectors, player.get("process_selectors"))
    return selectors


def _normalize_log_selectors(player: dict[str, Any]) -> dict[str, Any]:
    selectors = _pick_keys(player, LOG_SELECTOR_KEYS)
    selector_root = _as_mapping(player.get("selectors"))
    _merge_mapping(selectors, selector_root.get("log"))
    _merge_mapping(selectors, selector_root.get("logs"))
    _merge_mapping(selectors, player.get("log"))
    _merge_mapping(selectors, player.get("logs"))
    _merge_mapping(selectors, player.get("log_selectors"))
    return selectors


def _normalize_player(player: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(player, dict):
        return None

    player_id = _as_str(
        player.get("player_id")
        or player.get("id")
        or player.get("instance_id")
        or f"player-{index + 1}"
    )
    if not player_id:
        return None

    playout_type = _as_str(player.get("playout_type") or player.get("software") or "insta").lower()
    paths = _normalize_paths(player, playout_type)

    udp_inputs_raw = player.get("udp_inputs")
    if udp_inputs_raw is None:
        udp_probe = player.get("udp_probe")
        udp_inputs_raw = [udp_probe] if isinstance(udp_probe, dict) else []
    elif not isinstance(udp_inputs_raw, list):
        udp_inputs_raw = []

    udp_inputs: list[dict[str, Any]] = []
    for udp_index, udp_input in enumerate(udp_inputs_raw):
        normalized = _normalize_udp_input(player_id, udp_input, udp_index)
        if normalized is not None:
            udp_inputs.append(normalized)

    return {
        "player_id": player_id,
        "playout_type": playout_type,
        "paths": paths,
        "process_selectors": _normalize_process_selectors(player),
        "log_selectors": _normalize_log_selectors(player),
        "udp_inputs": udp_inputs,
    }


def normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    node_id = _as_str(raw.get("node_id") or raw.get("agent_id"))
    if not node_id:
        raise ValueError("config.yaml missing node_id (or legacy agent_id)")

    node_name = _as_str(raw.get("node_name") or raw.get("pc_name") or node_id)
    hub_url = _as_str(raw.get("hub_url"))
    agent_token = _as_str(raw.get("agent_token"))
    poll_interval_seconds = max(1, _as_int(raw.get("poll_interval_seconds"), 10))

    if not hub_url:
        raise ValueError("config.yaml missing hub_url")

    if not agent_token:
        raise ValueError("config.yaml missing agent_token")

    players_raw = raw.get("players")
    if players_raw is None:
        players_raw = raw.get("instances", [])

    if not isinstance(players_raw, list):
        raise ValueError("config.yaml players/instances must be a list")

    players: list[dict[str, Any]] = []
    for index, player in enumerate(players_raw):
        normalized = _normalize_player(player, index)
        if normalized is not None:
            players.append(normalized)

    if not players:
        raise ValueError("config.yaml must define at least one player")

    return {
        "node_id": node_id,
        "node_name": node_name,
        "site_id": _as_str(raw.get("site_id")),
        "hub_url": hub_url,
        "agent_token": agent_token,
        "poll_interval_seconds": poll_interval_seconds,
        "players": players,
    }


def load_config(config_path: str | None = None) -> dict[str, Any]:
    return normalize_config(_load_raw_config(config_path))


def validate_config_command(config_path: str | None = None) -> int:
    try:
        config = load_config(config_path)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}")
        return 1

    print(f"Config OK for node_id={config['node_id']} ({config['node_name']})")
    validation_failed = False
    enabled_udp_count = 0

    for player in config["players"]:
        player_id = player["player_id"]
        playout_type = player.get("playout_type", "insta")
        udp_inputs = player.get("udp_inputs", [])
        print(f"- {player_id} [{playout_type}]")

        if not udp_inputs:
            print("  UDP: none configured")
            continue

        for udp_input in udp_inputs:
            udp_input_id = udp_input["udp_input_id"]
            enabled = _as_bool(udp_input.get("enabled"), False)
            stream_url = _as_str(udp_input.get("stream_url"))
            status = "enabled" if enabled else "disabled"
            print(f"  - {udp_input_id}: {status}")
            print(f"    stream_url: {stream_url or '<empty>'}")

            if enabled:
                enabled_udp_count += 1
                if not stream_url:
                    print("    ERROR: enabled UDP input is missing stream_url")
                    validation_failed = True

    if enabled_udp_count > 0:
        for binary_name, binary_path in (("ffmpeg.exe", udp_probe.FFMPEG), ("ffprobe.exe", udp_probe.FFPROBE)):
            if not os.path.exists(binary_path):
                print(f"ERROR: {binary_name} not found at {binary_path}")
                validation_failed = True

    if validation_failed:
        print("Config validation failed.")
        return 1

    print("Config validation passed.")
    return 0


def _is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _relaunch_as_admin(args: list[str]) -> int:
    executable = sys.executable
    parameters = subprocess.list2cmdline(args)
    if not getattr(sys, "frozen", False):
        parameters = subprocess.list2cmdline([os.path.abspath(__file__), *args])

    result = ctypes.windll.shell32.ShellExecuteW(None, "runas", executable, parameters, None, 1)
    if result <= 32:
        print("ERROR: Unable to request Administrator privileges.")
        return 1
    return 0


def _run_command(command: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, capture_output=True, text=True)
    if check and completed.returncode != 0:
        stderr = completed.stderr.strip()
        stdout = completed.stdout.strip()
        details = stderr or stdout or f"exit code {completed.returncode}"
        raise RuntimeError(f"{' '.join(command)} failed: {details}")
    return completed


def _service_exists() -> bool:
    return subprocess.run(
        ["sc", "query", SERVICE_NAME],
        capture_output=True,
        text=True,
    ).returncode == 0


def _bundle_path(name: str) -> str:
    return os.path.join(_base_dir(), name)


def _installed_path(name: str) -> str:
    return os.path.join(INSTALL_DIR, name)


def _ensure_directory(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _copy_if_exists(source: str, destination: str) -> None:
    if os.path.exists(source):
        _ensure_directory(os.path.dirname(destination))
        if os.path.abspath(source) != os.path.abspath(destination):
            shutil.copy2(source, destination)


def _download_file(url: str, destination: str) -> None:
    response = requests.get(url, timeout=120, stream=True)
    response.raise_for_status()
    with open(destination, "wb") as handle:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                handle.write(chunk)


def _extract_from_zip(zip_path: str, suffix: str, destination: str) -> bool:
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.namelist():
            if member.lower().endswith(suffix.lower()):
                with archive.open(member) as source, open(destination, "wb") as target:
                    shutil.copyfileobj(source, target)
                return True
    return False


def _ensure_nssm() -> str:
    install_target = _installed_path("nssm.exe")
    if os.path.exists(install_target):
        return install_target

    bundle_target = _bundle_path("nssm.exe")
    if os.path.exists(bundle_target):
        _copy_if_exists(bundle_target, install_target)
        return install_target

    _ensure_directory(INSTALL_DIR)
    with tempfile.TemporaryDirectory(prefix="pulse-nssm-") as temp_dir:
        package_path = os.path.join(temp_dir, "nssm.nupkg")
        _download_file(NSSM_PACKAGE_URL, package_path)
        if not _extract_from_zip(package_path, os.path.join("win64", "nssm.exe"), install_target):
            if not _extract_from_zip(package_path, "nssm.exe", install_target):
                raise RuntimeError("Failed to extract nssm.exe from downloaded package.")

    return install_target


def _ensure_ff_tools(required: bool) -> None:
    ffmpeg_target = _installed_path("ffmpeg.exe")
    ffprobe_target = _installed_path("ffprobe.exe")

    if os.path.exists(ffmpeg_target) and os.path.exists(ffprobe_target):
        return

    _copy_if_exists(_bundle_path("ffmpeg.exe"), ffmpeg_target)
    _copy_if_exists(_bundle_path("ffprobe.exe"), ffprobe_target)
    if os.path.exists(ffmpeg_target) and os.path.exists(ffprobe_target):
        return

    try:
        with tempfile.TemporaryDirectory(prefix="pulse-ffmpeg-") as temp_dir:
            archive_path = os.path.join(temp_dir, "ffmpeg.zip")
            _download_file(FFMPEG_ARCHIVE_URL, archive_path)
            if not _extract_from_zip(archive_path, "ffmpeg.exe", ffmpeg_target):
                raise RuntimeError("Failed to extract ffmpeg.exe from downloaded archive.")
            if not _extract_from_zip(archive_path, "ffprobe.exe", ffprobe_target):
                raise RuntimeError("Failed to extract ffprobe.exe from downloaded archive.")
    except Exception:
        if required:
            raise


def _stop_existing_service(nssm_path: str | None = None) -> None:
    if not _service_exists():
        return

    chosen_nssm = nssm_path if nssm_path and os.path.exists(nssm_path) else ""
    if not chosen_nssm and os.path.exists(_installed_path("nssm.exe")):
        chosen_nssm = _installed_path("nssm.exe")

    if chosen_nssm:
        subprocess.run([chosen_nssm, "stop", SERVICE_NAME], capture_output=True, text=True)
        subprocess.run([chosen_nssm, "remove", SERVICE_NAME, "confirm"], capture_output=True, text=True)
    else:
        subprocess.run(["sc", "stop", SERVICE_NAME], capture_output=True, text=True)
        subprocess.run(["sc", "delete", SERVICE_NAME], capture_output=True, text=True)

    installed_exe = os.path.abspath(_installed_path("clarix-agent.exe"))
    current_pid = os.getpid()
    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid == current_pid:
                continue
            name = str(proc.info.get("name") or "").lower()
            exe_path = os.path.abspath(str(proc.info.get("exe") or ""))
            if name not in {"clarix-agent.exe", "clarix-agent"}:
                continue
            if exe_path and exe_path != installed_exe:
                continue
            proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError, ValueError):
            continue

    time.sleep(2)


def _write_yaml(path: str, data: dict[str, Any]) -> None:
    _ensure_directory(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=False)


def _load_yaml_if_exists(path: str) -> dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    return data if isinstance(data, dict) else {}


def _runtime_config_path() -> str:
    installed_config = _installed_path("config.yaml")
    return installed_config if os.path.exists(installed_config) else os.path.join(_base_dir(), "config.yaml")


def _sync_udp_inputs(player_id: str, value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(value[:5]):
        udp_input = _normalize_udp_input(player_id, entry, index)
        if udp_input is not None:
            normalized.append(udp_input)
    return normalized


def _apply_desired_node_config(config_path: str, desired_node_config: Any) -> bool:
    if not isinstance(desired_node_config, dict):
        return False

    desired_players = desired_node_config.get("players")
    if not isinstance(desired_players, list):
        return False

    raw_config = _load_yaml_if_exists(config_path)
    if not raw_config:
        return False

    players_key = "players" if isinstance(raw_config.get("players"), list) else "instances" if isinstance(raw_config.get("instances"), list) else ""
    if not players_key:
        return False

    players_raw = raw_config.get(players_key)
    if not isinstance(players_raw, list):
        return False

    changed = False
    for desired_player in desired_players:
        if not isinstance(desired_player, dict):
            continue

        desired_player_id = _as_str(
            desired_player.get("playerId")
            or desired_player.get("player_id")
            or desired_player.get("id")
            or desired_player.get("instance_id")
        )
        if not desired_player_id:
            continue

        desired_udp_inputs = _sync_udp_inputs(
            desired_player_id,
            desired_player.get("udpInputs", desired_player.get("udp_inputs", [])),
        )

        for index, player in enumerate(players_raw):
            if not isinstance(player, dict):
                continue

            current_player_id = _as_str(
                player.get("player_id")
                or player.get("id")
                or player.get("instance_id")
            )
            if current_player_id != desired_player_id:
                continue

            current_udp_inputs = _sync_udp_inputs(desired_player_id, player.get("udp_inputs", []))
            if current_udp_inputs != desired_udp_inputs:
                player["udp_inputs"] = desired_udp_inputs
                player.pop("udp_probe", None)
                players_raw[index] = player
                changed = True
            break

    if changed:
        raw_config[players_key] = players_raw
        _write_yaml(config_path, raw_config)

    return changed


def _contains_placeholder(value: Any) -> bool:
    if isinstance(value, str):
        return "REPLACE_ME" in value
    if isinstance(value, dict):
        return any(_contains_placeholder(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_placeholder(item) for item in value)
    return False


def _prompt(text: str, default: str = "", required: bool = False) -> str:
    while True:
        suffix = f" [{default}]" if default else ""
        response = input(f"{text}{suffix}: ").strip()
        if response:
            return response
        if default:
            return default
        if not required:
            return ""
        print("A value is required.")


def _prompt_int(text: str, default: int, minimum: int, maximum: int) -> int:
    while True:
        raw = _prompt(text, str(default), required=True)
        try:
            value = int(raw)
        except ValueError:
            print("Enter a number.")
            continue
        if minimum <= value <= maximum:
            return value
        print(f"Enter a value between {minimum} and {maximum}.")


def _prompt_yes_no(text: str, default: bool) -> bool:
    default_label = "Y/n" if default else "y/N"
    while True:
        response = input(f"{text} [{default_label}]: ").strip().lower()
        if not response:
            return default
        if response in {"y", "yes"}:
            return True
        if response in {"n", "no"}:
            return False
        print("Enter y or n.")


def _prompt_choice(text: str, choices: list[str], default: str) -> str:
    allowed = {choice.lower(): choice for choice in choices}
    while True:
        response = _prompt(text, default, required=True).lower()
        if response in allowed:
            return allowed[response]
        print(f"Choose one of: {', '.join(choices)}")


def _default_site_id(node_id: str) -> str:
    lowered = node_id.lower()
    return lowered[:-3] if lowered.endswith("-pc") else lowered


def _default_player_id(node_id: str, playout_type: str, index: int) -> str:
    return f"{node_id}-{playout_type}-{index + 1}"


def _build_udp_inputs(player_id: str, existing_inputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    count_default = min(5, len(existing_inputs)) if existing_inputs else 0
    udp_count = _prompt_int("How many UDP inputs should this player expose", count_default, 0, 5)
    udp_inputs: list[dict[str, Any]] = []

    for index in range(udp_count):
        existing = existing_inputs[index] if index < len(existing_inputs) else {}
        udp_input_id = _prompt(
            f"UDP input {index + 1} ID",
            _as_str(existing.get("udp_input_id"), f"{player_id}-udp-{index + 1}"),
            required=True,
        )
        enabled = _prompt_yes_no(
            f"Enable UDP input {udp_input_id}",
            _as_bool(existing.get("enabled"), False),
        )
        stream_url = _prompt(
            f"UDP stream URL for {udp_input_id}",
            _as_str(existing.get("stream_url")),
            required=False,
        )
        stream_url = udp_probe.normalize_stream_url(stream_url)
        thumbnail_interval = _prompt_int(
            f"Thumbnail interval seconds for {udp_input_id}",
            _as_int(existing.get("thumbnail_interval_s"), 10),
            1,
            300,
        )
        udp_inputs.append(
            {
                "udp_input_id": udp_input_id,
                "enabled": enabled,
                "stream_url": stream_url,
                "thumbnail_interval_s": thumbnail_interval,
            }
        )

    return udp_inputs


def _prompt_player(index: int, existing_player: dict[str, Any], node_id: str) -> dict[str, Any]:
    existing_type = _as_str(existing_player.get("playout_type"), "insta").lower()
    playout_type = _prompt_choice(
        f"Player {index + 1} playout type",
        ["insta", "admax"],
        existing_type if existing_type in {"insta", "admax"} else "insta",
    )
    player_id = _prompt(
        f"Player {index + 1} ID",
        _as_str(existing_player.get("player_id"), _default_player_id(node_id, playout_type, index)),
        required=True,
    )

    existing_paths = _as_mapping(existing_player.get("paths"))
    if playout_type == "insta":
        paths = {
            "shared_log_dir": _prompt(
                f"{player_id} shared_log_dir",
                _as_str(existing_paths.get("shared_log_dir"), DEFAULT_INSTA_LOG_DIR),
                required=True,
            ),
            "instance_root": _prompt(
                f"{player_id} instance_root",
                _as_str(existing_paths.get("instance_root"), DEFAULT_INSTA_INSTANCE_ROOT),
                required=True,
            ),
        }
    else:
        detected_root = _best_existing_dir(_default_admax_root_patterns())
        paths = {
            "admax_root_candidates": [
                _prompt(
                    f"{player_id} Admax root",
                    _as_str(existing_paths.get("admax_root"), detected_root),
                    required=True,
                )
            ]
        }

    return {
        "player_id": player_id,
        "playout_type": playout_type,
        "paths": paths,
        "udp_inputs": _build_udp_inputs(player_id, existing_player.get("udp_inputs", [])),
    }


def _run_config_wizard(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing or {}
    existing_players = existing.get("players") if isinstance(existing.get("players"), list) else []

    node_id = _prompt(
        "Node ID",
        _as_str(existing.get("node_id"), socket.gethostname().lower().replace(" ", "-")),
        required=True,
    )
    node_name = _prompt(
        "Node name",
        _as_str(existing.get("node_name"), socket.gethostname()),
        required=True,
    )
    site_id = _prompt(
        "Site ID",
        _as_str(existing.get("site_id"), _default_site_id(node_id)),
        required=True,
    )
    hub_url = _prompt(
        "Hub URL",
        _as_str(existing.get("hub_url"), DEFAULT_HUB_URL),
        required=True,
    )
    agent_token = _prompt(
        "Agent token",
        _as_str(existing.get("agent_token")),
        required=True,
    )
    poll_interval = _prompt_int(
        "Poll interval seconds",
        _as_int(existing.get("poll_interval_seconds"), 5),
        1,
        120,
    )
    player_count = _prompt_int(
        "How many players run on this node",
        len(existing_players) or 1,
        1,
        10,
    )

    players: list[dict[str, Any]] = []
    for index in range(player_count):
        existing_player = existing_players[index] if index < len(existing_players) else {}
        players.append(_prompt_player(index, existing_player, node_id))

    return {
        "node_id": node_id,
        "node_name": node_name,
        "site_id": site_id,
        "hub_url": hub_url,
        "agent_token": agent_token,
        "poll_interval_seconds": poll_interval,
        "players": players,
    }


def _stage_runtime_files() -> str:
    _ensure_directory(INSTALL_DIR)
    staged_exe = _installed_path("clarix-agent.exe")
    _copy_if_exists(_current_executable_path(), staged_exe)

    for filename in ("install.bat", "configure.bat", "uninstall.bat", "config.example.yaml"):
        _copy_if_exists(_bundle_path(filename), _installed_path(filename))

    return staged_exe


def _load_or_prepare_config(config_path: str) -> dict[str, Any]:
    existing = _load_yaml_if_exists(config_path)
    if not existing and os.path.exists(_bundle_path("config.yaml")):
        _copy_if_exists(_bundle_path("config.yaml"), config_path)
        existing = _load_yaml_if_exists(config_path)

    if existing and not _contains_placeholder(existing):
        try:
            load_config(config_path)
            return existing
        except (FileNotFoundError, ValueError):
            pass

    print()
    print("Pulse will guide the node configuration now.")
    configured = _run_config_wizard(existing)
    _write_yaml(config_path, configured)
    load_config(config_path)
    return configured


def install_service_command() -> int:
    if not _is_admin():
        print("Administrator approval is required for the Pulse installation.")
        return _relaunch_as_admin(["--install-service"])

    try:
        nssm_path = _ensure_nssm()
        _stop_existing_service(nssm_path)
        staged_exe = _stage_runtime_files()
        config_path = _installed_path("config.yaml")
        raw_config = _load_or_prepare_config(config_path)
        validated_config = load_config(config_path)
        _ensure_ff_tools(required=True)

        _run_command([nssm_path, "install", SERVICE_NAME, staged_exe, "--service-loop"])
        _run_command([nssm_path, "set", SERVICE_NAME, "DisplayName", SERVICE_DISPLAY_NAME])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppDirectory", INSTALL_DIR])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppStdout", _installed_path("clarix-agent.log")])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppStderr", _installed_path("clarix-agent.log")])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppRotateFiles", "1"])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppRotateBytes", "10485760"])
        _run_command([nssm_path, "set", SERVICE_NAME, "AppRestartDelay", "5000"])
        _run_command([nssm_path, "set", SERVICE_NAME, "Start", "SERVICE_AUTO_START"])
        _run_command(["sc", "description", SERVICE_NAME, "Pulse local node monitoring agent"])
        _run_command([nssm_path, "start", SERVICE_NAME])

        print()
        print("Pulse installation complete.")
        print(f"Node: {validated_config['node_id']} ({validated_config['node_name']})")
        print(f"Installed to: {INSTALL_DIR}")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


def configure_command() -> int:
    if not _is_admin():
        print("Administrator approval is required to update Pulse configuration.")
        return _relaunch_as_admin(["--configure"])

    try:
        config_path = _installed_path("config.yaml")
        if not os.path.exists(config_path) and os.path.exists(_bundle_path("config.yaml")):
            _copy_if_exists(_bundle_path("config.yaml"), config_path)

        existing = _load_yaml_if_exists(config_path)
        configured = _run_config_wizard(existing)
        _write_yaml(config_path, configured)
        load_config(config_path)

        udp_enabled = any(
            _as_bool(udp_input.get("enabled"), False)
            for player in configured.get("players", [])
            if isinstance(player, dict)
            for udp_input in player.get("udp_inputs", [])
            if isinstance(udp_input, dict)
        )
        _ensure_ff_tools(required=udp_enabled)

        if _service_exists():
            nssm_path = _ensure_nssm()
            _run_command([nssm_path, "restart", SERVICE_NAME])

        print()
        print("Pulse configuration updated.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


def uninstall_service_command() -> int:
    if not _is_admin():
        print("Administrator approval is required to uninstall Pulse.")
        return _relaunch_as_admin(["--uninstall-service"])

    try:
        nssm_path = _installed_path("nssm.exe") if os.path.exists(_installed_path("nssm.exe")) else ""
        _stop_existing_service(nssm_path or None)

        if os.path.exists(INSTALL_DIR) and _prompt_yes_no(f"Delete installed files from {INSTALL_DIR}", False):
            shutil.rmtree(INSTALL_DIR, ignore_errors=True)

        print("Pulse uninstalled.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


def _is_interactive_session() -> bool:
    session_name = os.environ.get("SESSIONNAME", "")
    return sys.stdin.isatty() and session_name.lower() != "services"


def interactive_entrypoint() -> int:
    if os.path.abspath(_base_dir()) != os.path.abspath(INSTALL_DIR) or not _service_exists():
        return install_service_command()

    print("Pulse Agent")
    print("1. Install or update service")
    print("2. Configure node")
    print("3. Run monitoring now")
    print("4. Uninstall")
    print("5. Exit")
    choice = _prompt_choice("Choose an action", ["1", "2", "3", "4", "5"], "2")
    if choice == "1":
        return install_service_command()
    if choice == "2":
        return configure_command()
    if choice == "4":
        return uninstall_service_command()
    if choice == "5":
        return 0
    return run_agent_loop()


# --- Heartbeat ----------------------------------------------------------------

def post_heartbeat(
    hub_url: str,
    token: str,
    node_id: str,
    player_id: str,
    observations: dict[str, Any],
) -> dict[str, Any] | None:
    url = f"{hub_url}/api/heartbeat"
    payload = {
        "agentId": node_id,
        "instanceId": player_id,
        "nodeId": node_id,
        "playerId": player_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "observations": observations,
    }
    try:
        r = requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if r.status_code == 200:
            try:
                payload = r.json()
            except ValueError:
                payload = {}
            return payload if isinstance(payload, dict) else {}
        log.warning(f"Heartbeat rejected for {player_id}: {r.status_code} {r.text[:200]}")
        return None
    except requests.RequestException as e:
        log.warning(f"Heartbeat POST failed for {player_id}: {e}")
        return None


def post_thumbnail(
    hub_url: str,
    token: str,
    node_id: str,
    player_id: str,
    udp_input_id: str,
    data_url: str,
) -> None:
    url = f"{hub_url}/api/thumbnail"
    payload = {
        "agentId": node_id,
        "instanceId": player_id,
        "nodeId": node_id,
        "playerId": player_id,
        "udpInputId": udp_input_id,
        "dataUrl": data_url,
        "capturedAt": datetime.utcnow().isoformat() + "Z",
    }
    try:
        requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except requests.RequestException as e:
        log.debug(f"Thumbnail POST failed for {player_id}/{udp_input_id}: {e}")


# --- Player polling ------------------------------------------------------------

_last_thumbnail_at: dict[str, float] = {}


def _thumbnail_key(node_id: str, player_id: str, udp_input_id: str) -> str:
    return f"{node_id}:{player_id}:{udp_input_id}"


def _udp_rank(result: dict[str, Any]) -> tuple[int, float, float, float]:
    metrics = result.get("metrics", {})
    present = 1 if metrics.get("output_signal_present") == 1 else 0
    freeze = float(metrics.get("output_freeze_seconds") or 0.0)
    black = float(metrics.get("output_black_ratio") or 0.0)
    silence = float(metrics.get("output_audio_silence_seconds") or 0.0)
    return (present, -freeze, -black, -silence)


def _collect_udp_matrix(
    player_id: str,
    udp_inputs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, int, int]:
    matrix: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    enabled_count = 0
    healthy_count = 0

    for udp_input in udp_inputs:
        udp_input_id = udp_input["udp_input_id"]
        enabled = _as_bool(udp_input.get("enabled"), False)
        stream_url = _as_str(udp_input.get("stream_url"))
        thumbnail_interval = _as_int(udp_input.get("thumbnail_interval_s"), 10)

        entry: dict[str, Any] = {
            "udp_input_id": udp_input_id,
            "enabled": enabled,
            "stream_url_present": bool(stream_url),
        }

        if enabled:
            enabled_count += 1

        if not enabled:
            entry["skipped"] = True
            matrix.append(entry)
            continue

        if not stream_url:
            entry["error"] = "missing stream_url"
            matrix.append(entry)
            continue

        try:
            probe_result = udp_probe.check(stream_url)
            metrics = {
                "output_signal_present": int(probe_result.get("output_signal_present", 0) or 0),
                "output_freeze_seconds": float(probe_result.get("output_freeze_seconds") or 0.0),
                "output_black_ratio": float(probe_result.get("output_black_ratio") or 0.0),
                "output_audio_silence_seconds": float(probe_result.get("output_audio_silence_seconds") or 0.0),
            }
            healthy = (
                metrics["output_signal_present"] == 1
                and metrics["output_freeze_seconds"] < 20
                and metrics["output_black_ratio"] < 0.98
            )

            entry.update(metrics)
            entry["healthy"] = healthy
            if healthy:
                healthy_count += 1

            candidates.append(
                {
                    "udp_input_id": udp_input_id,
                    "stream_url": stream_url,
                    "thumbnail_interval_s": thumbnail_interval,
                    "metrics": metrics,
                }
            )
        except Exception as e:
            entry["error"] = str(e)
            log.debug(f"[{player_id}/{udp_input_id}] UDP probe error: {e}")

        matrix.append(entry)

    primary: dict[str, Any] | None = None
    if candidates:
        primary = max(candidates, key=_udp_rank)

    return matrix, primary, enabled_count, healthy_count


def _maybe_capture_thumbnail(
    node_id: str,
    player_id: str,
    udp_input_id: str,
    stream_url: str,
    thumbnail_interval: int,
) -> str | None:
    now = time.time()
    thumb_key = _thumbnail_key(node_id, player_id, udp_input_id)
    last_thumb = _last_thumbnail_at.get(thumb_key, 0)
    if now - last_thumb < thumbnail_interval:
        return None

    try:
        data_url = udp_probe.capture_thumbnail(stream_url)
    except Exception as e:
        log.debug(f"[{player_id}/{udp_input_id}] thumbnail capture error: {e}")
        return None

    if data_url:
        _last_thumbnail_at[thumb_key] = now

    return data_url


def poll_player(node_id: str, hub_url: str, token: str, player: dict[str, Any]) -> dict[str, Any] | None:
    player_id = player["player_id"]
    playout_type = player.get("playout_type", "insta")
    paths = player.get("paths", {})
    process_selectors = player.get("process_selectors", {})
    log_selectors = player.get("log_selectors", {})
    udp_inputs = player.get("udp_inputs", [])

    observations: dict[str, Any] = {}

    # 1. Process and window presence
    try:
        obs = process_monitor.check(player_id, playout_type, process_selectors)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{player_id}] process check error: {e}")

    # 2. Deep log monitoring
    try:
        obs = log_monitor.check(player_id, playout_type, paths, log_selectors)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{player_id}] log monitor error: {e}")

    # 3. File state (stall detection + content errors)
    try:
        obs = file_monitor.check(player_id, playout_type, paths)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{player_id}] file monitor error: {e}")

    # 4. Connectivity
    try:
        obs = connectivity.check()
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{player_id}] connectivity check error: {e}")

    # 5. UDP matrix (optional per input)
    udp_matrix, primary_udp, enabled_udp_count, healthy_udp_count = _collect_udp_matrix(player_id, udp_inputs)
    observations["udp_enabled"] = 1 if enabled_udp_count > 0 else 0
    observations["udp_input_count"] = enabled_udp_count
    observations["udp_healthy_input_count"] = healthy_udp_count
    observations["udp_selected_input_id"] = primary_udp["udp_input_id"] if primary_udp else None
    if udp_matrix:
        observations["udp_matrix"] = udp_matrix

    thumbnail_data_url = None
    thumbnail_udp_input_id = None
    if primary_udp:
        observations.update(primary_udp.get("metrics", {}))

        thumbnail_udp_input_id = primary_udp["udp_input_id"]
        thumbnail_data_url = _maybe_capture_thumbnail(
            node_id,
            player_id,
            thumbnail_udp_input_id,
            primary_udp["stream_url"],
            _as_int(primary_udp.get("thumbnail_interval_s"), 10),
        )

    # POST heartbeat
    response_payload = post_heartbeat(hub_url, token, node_id, player_id, observations)
    if response_payload is not None:
        log.debug(f"[{player_id}] heartbeat OK — {observations}")

    # POST thumbnail if captured
    if thumbnail_data_url and thumbnail_udp_input_id:
        post_thumbnail(hub_url, token, node_id, player_id, thumbnail_udp_input_id, thumbnail_data_url)

    if isinstance(response_payload, dict):
        desired_node_config = response_payload.get("desiredNodeConfig")
        return desired_node_config if isinstance(desired_node_config, dict) else None

    return None


# --- Main loop ----------------------------------------------------------------

def run_agent_loop() -> int:
    config_path = _runtime_config_path()
    last_config_signature = ""

    while True:
        config = load_config(config_path)

        node_id = config["node_id"]
        node_name = config["node_name"]
        hub_url = config["hub_url"].rstrip("/")
        token = config["agent_token"]
        poll_interval = int(config.get("poll_interval_seconds", 10))
        players = config.get("players", [])

        config_signature = json.dumps(
            {
                "node_id": node_id,
                "hub_url": hub_url,
                "poll_interval_seconds": poll_interval,
                "players": players,
            },
            sort_keys=True,
        )
        if config_signature != last_config_signature:
            log.info(f"Pulse Agent starting — node_id={node_id}, node_name={node_name}, hub={hub_url}")
            log.info(f"Monitoring {len(players)} player(s): {[p['player_id'] for p in players]}")
            last_config_signature = config_signature

        cycle_start = time.time()
        applied_desired_config = False

        for player in players:
            try:
                desired_node_config = poll_player(node_id, hub_url, token, player)
                if desired_node_config and not applied_desired_config:
                    if _apply_desired_node_config(config_path, desired_node_config):
                        applied_desired_config = True
                        log.info("Applied managed UDP config from the hub. Local config.yaml is now in sync.")
            except Exception:
                log.error(f"Unhandled error polling {player.get('player_id', '?')}:\n{traceback.format_exc()}")

        elapsed = time.time() - cycle_start
        sleep_time = max(0, poll_interval - elapsed)
        time.sleep(sleep_time)

    return 0


def main() -> int:
    args = sys.argv[1:]
    if args:
        command = args[0]
        if command == "--validate-config":
            config_path = args[1] if len(args) > 1 else None
            return validate_config_command(config_path)
        if command == "--install-service":
            return install_service_command()
        if command == "--configure":
            return configure_command()
        if command == "--uninstall-service":
            return uninstall_service_command()
        if command == "--service-loop":
            return run_agent_loop()

    if _is_interactive_session():
        return interactive_entrypoint()

    return run_agent_loop()


if __name__ == "__main__":
    sys.exit(main())
