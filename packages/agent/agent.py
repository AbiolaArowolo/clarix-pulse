"""
Pulse - Local Monitoring Agent.
Runs as a Windows Service via NSSM. Polls every N seconds, POSTs one heartbeat
per player to the hub. Sends raw observations only - hub computes health state.
"""

import os
import sys
import time
import glob
import logging
import traceback
from datetime import datetime
from typing import Any

import yaml
import requests

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


def _load_raw_config() -> dict[str, Any]:
    config_path = os.path.join(
        os.path.dirname(sys.executable if getattr(sys, "frozen", False) else __file__),
        "config.yaml",
    )
    if not os.path.exists(config_path):
        log.error(f"config.yaml not found at {config_path}")
        sys.exit(1)

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    if not isinstance(data, dict):
        log.error("config.yaml must contain a mapping at the top level")
        sys.exit(1)

    return data


def _normalize_udp_input(player_id: str, udp_input: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(udp_input, dict):
        return None

    udp_input_id = _as_str(
        udp_input.get("udp_input_id")
        or udp_input.get("id")
        or udp_input.get("input_id")
        or f"{player_id}-udp-{index + 1}"
    )

    return {
        "udp_input_id": udp_input_id,
        "enabled": _as_bool(udp_input.get("enabled"), False),
        "stream_url": udp_probe.normalize_stream_url(udp_input.get("stream_url")),
        "thumbnail_interval_s": _as_int(udp_input.get("thumbnail_interval_s"), 10),
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
        log.error("config.yaml missing node_id (or legacy agent_id)")
        sys.exit(1)

    node_name = _as_str(raw.get("node_name") or raw.get("pc_name") or node_id)
    hub_url = _as_str(raw.get("hub_url"))
    agent_token = _as_str(raw.get("agent_token"))
    poll_interval_seconds = max(1, _as_int(raw.get("poll_interval_seconds"), 10))

    if not hub_url:
        log.error("config.yaml missing hub_url")
        sys.exit(1)

    if not agent_token:
        log.error("config.yaml missing agent_token")
        sys.exit(1)

    players_raw = raw.get("players")
    if players_raw is None:
        players_raw = raw.get("instances", [])

    if not isinstance(players_raw, list):
        log.error("config.yaml players/instances must be a list")
        sys.exit(1)

    players: list[dict[str, Any]] = []
    for index, player in enumerate(players_raw):
        normalized = _normalize_player(player, index)
        if normalized is not None:
            players.append(normalized)

    if not players:
        log.error("config.yaml must define at least one player")
        sys.exit(1)

    return {
        "node_id": node_id,
        "node_name": node_name,
        "hub_url": hub_url,
        "agent_token": agent_token,
        "poll_interval_seconds": poll_interval_seconds,
        "players": players,
    }


def load_config() -> dict[str, Any]:
    return normalize_config(_load_raw_config())


def validate_config_command() -> int:
    try:
        config = load_config()
    except SystemExit as exc:
        return int(exc.code or 1)

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


# --- Heartbeat ----------------------------------------------------------------

def post_heartbeat(
    hub_url: str,
    token: str,
    node_id: str,
    player_id: str,
    observations: dict[str, Any],
) -> bool:
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
            return True
        log.warning(f"Heartbeat rejected for {player_id}: {r.status_code} {r.text[:200]}")
        return False
    except requests.RequestException as e:
        log.warning(f"Heartbeat POST failed for {player_id}: {e}")
        return False


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


def poll_player(node_id: str, hub_url: str, token: str, player: dict[str, Any]) -> None:
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
    success = post_heartbeat(hub_url, token, node_id, player_id, observations)
    if success:
        log.debug(f"[{player_id}] heartbeat OK — {observations}")

    # POST thumbnail if captured
    if thumbnail_data_url and thumbnail_udp_input_id:
        post_thumbnail(hub_url, token, node_id, player_id, thumbnail_udp_input_id, thumbnail_data_url)


# --- Main loop ----------------------------------------------------------------

def main() -> None:
    config = load_config()

    node_id = config["node_id"]
    node_name = config["node_name"]
    hub_url = config["hub_url"].rstrip("/")
    token = config["agent_token"]
    poll_interval = int(config.get("poll_interval_seconds", 10))
    players = config.get("players", [])

    log.info(f"Pulse Agent starting — node_id={node_id}, node_name={node_name}, hub={hub_url}")
    log.info(f"Monitoring {len(players)} player(s): {[p['player_id'] for p in players]}")

    while True:
        cycle_start = time.time()

        for player in players:
            try:
                poll_player(node_id, hub_url, token, player)
            except Exception:
                log.error(f"Unhandled error polling {player.get('player_id', '?')}:\n{traceback.format_exc()}")

        elapsed = time.time() - cycle_start
        sleep_time = max(0, poll_interval - elapsed)
        time.sleep(sleep_time)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--validate-config":
        sys.exit(validate_config_command())
    main()
