from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from learning_store import LearningStore


GENERIC_PLAYOUT_TYPE = "generic_windows"


def _module_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def _load_manifest() -> dict[str, Any]:
    manifest_path = _module_root() / "fingerprint_manifest.json"
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _profile_index() -> dict[str, dict[str, Any]]:
    manifest = _load_manifest()
    profiles = manifest.get("profiles") or []
    return {
        str(profile.get("id") or profile.get("player_type")): profile
        for profile in profiles
        if isinstance(profile, dict) and (profile.get("id") or profile.get("player_type"))
    }


def _confidence_thresholds() -> dict[str, float]:
    manifest = _load_manifest()
    raw = manifest.get("confidence_thresholds") or {}
    high = float(raw.get("high", 0.85))
    medium = float(raw.get("medium", 0.60))
    low = float(raw.get("low", 0.0))
    return {
        "high": high,
        "medium": medium,
        "low": low,
    }


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[str]:
    if isinstance(value, str):
        cleaned = value.strip()
        return [cleaned] if cleaned else []
    if not isinstance(value, list):
        return []
    values: list[str] = []
    for entry in value:
        cleaned = str(entry).strip()
        if cleaned:
            values.append(cleaned)
    return values


def _first(items: list[str]) -> str:
    return items[0] if items else ""


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for item in items:
        lowered = item.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(item)
    return normalized


def _profile_for_player_type(player_type: str) -> dict[str, Any]:
    profiles = _profile_index()
    return profiles.get(player_type) or profiles[GENERIC_PLAYOUT_TYPE]


def _profile_label(player_type: str) -> str:
    profile = _profile_for_player_type(player_type)
    return str(profile.get("label") or player_type.replace("_", " ").title())


def _variant_terms(profile: dict[str, Any], player_type: str) -> list[str]:
    candidates = [
        str(profile.get("vendor") or "").strip(),
        str(profile.get("label") or "").strip(),
        player_type,
        *[str(value).strip() for value in profile.get("aliases", []) if str(value).strip()],
        *[str(value).strip() for value in profile.get("known_variants", []) if str(value).strip()],
    ]
    return [candidate.lower() for candidate in candidates if candidate]


def _joined_text(texts: list[str]) -> str:
    return " ".join(text.lower() for text in texts if text).strip()


def _variant_strength(profile: dict[str, Any], player_type: str, texts: list[str]) -> float:
    joined = _joined_text(texts)
    if not joined:
        return 0.45

    for candidate in _variant_terms(profile, player_type):
        normalized = candidate.replace("_", " ")
        if normalized and normalized in joined:
            return 1.0

    return 0.65


def _presence_strength(
    signals: list[str],
    base: float,
    increment: float,
    ceiling: float = 1.0,
) -> float:
    if not signals:
        return 0.0
    return min(ceiling, base + increment * max(0, len(signals) - 1))


def _blend_strength(presence: float, variant: float, bonus: float = 0.0) -> float:
    if presence <= 0:
        return 0.0
    return min(1.0, round((presence * 0.65) + (variant * 0.35) + bonus, 3))


def _evidence_texts(player: dict[str, Any]) -> list[str]:
    discovery = _as_mapping(player.get("discovery"))
    return _unique(_as_list(discovery.get("evidence")))


def _selectors(player: dict[str, Any]) -> dict[str, Any]:
    return _as_mapping(player.get("process_selectors") or player.get("processSelectors"))


def _log_selectors(player: dict[str, Any]) -> dict[str, Any]:
    return _as_mapping(player.get("log_selectors") or player.get("logSelectors"))


def _paths(player: dict[str, Any]) -> dict[str, Any]:
    return _as_mapping(player.get("paths"))


def _add_contribution(
    contributions: list[dict[str, Any]],
    profile: dict[str, Any],
    evidence_type: str,
    strength: float,
    summary: str,
    sources: list[str],
) -> None:
    weight = float(_as_mapping(profile.get("evidence_weights")).get(evidence_type, 0.0))
    if weight <= 0 or strength <= 0:
        return
    contribution = round(min(0.99, weight * strength), 3)
    contributions.append(
        {
            "type": evidence_type,
            "weight": round(weight, 3),
            "strength": round(strength, 3),
            "contribution": contribution,
            "summary": summary,
            "sources": _unique(sources)[:6],
        }
    )


def _score_process_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    # Process selectors are also used as monitor configuration for not-running players.
    # Only score "process evidence" when discovery marked the player as currently running.
    if not bool(player.get("running")):
        return

    selectors = _selectors(player)
    signals = _unique(
        _as_list(selectors.get("process_names"))
        + _as_list(selectors.get("executable_path_contains"))
        + _as_list(selectors.get("command_line_contains"))
        + _as_list(selectors.get("process_name_regex"))
        + _as_list(selectors.get("command_line_regex"))
    )
    presence = _presence_strength(signals, 0.62, 0.12)
    variant = _variant_strength(profile, player_type, signals + _evidence_texts(player))
    strength = _blend_strength(presence, variant, 0.05 if player.get("running") else 0.0)
    _add_contribution(
        contributions,
        profile,
        "process",
        strength,
        "Running process and command-line matches",
        signals,
    )


def _score_service_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    selectors = _selectors(player)
    signals = _unique(
        _as_list(selectors.get("service_names"))
        + _as_list(selectors.get("service_display_name_contains"))
        + _as_list(selectors.get("service_path_contains"))
        + _as_list(selectors.get("service_name_regex"))
    )
    presence = _presence_strength(signals, 0.66, 0.12)
    variant = _variant_strength(profile, player_type, signals + _evidence_texts(player))
    strength = _blend_strength(presence, variant, 0.04 if player.get("running") else 0.0)
    _add_contribution(
        contributions,
        profile,
        "service",
        strength,
        "Windows service fingerprints",
        signals,
    )


def _score_registry_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    registry_hits = [
        text
        for text in _evidence_texts(player)
        if "registry" in text.lower() or "uninstall" in text.lower()
    ]
    if not registry_hits:
        return
    strength = _blend_strength(0.88, _variant_strength(profile, player_type, registry_hits))
    _add_contribution(
        contributions,
        profile,
        "registry",
        strength,
        "Installed product registry matches",
        registry_hits,
    )


def _score_path_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    paths = _paths(player)
    signals = _unique(
        _as_list(paths.get("install_dir"))
        + _as_list(paths.get("instance_root"))
        + _as_list(paths.get("shared_log_dir"))
        + _as_list(paths.get("admax_root"))
        + _as_list(paths.get("admax_root_candidates"))
        + _as_list(paths.get("log_path"))
        + _as_list(paths.get("playout_log_dir"))
    )
    presence = _presence_strength(signals, 0.58, 0.08)
    variant = _variant_strength(profile, player_type, signals)
    strength = _blend_strength(presence, variant)
    _add_contribution(
        contributions,
        profile,
        "path",
        strength,
        "Install and runtime path fingerprints",
        signals,
    )


def _score_log_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    paths = _paths(player)
    log_selectors = _log_selectors(player)
    signals = _unique(
        _as_list(paths.get("fnf_log"))
        + _as_list(paths.get("playlistscan_log"))
        + _as_list(paths.get("log_path"))
        + _as_list(paths.get("playout_log_dir"))
        + _as_list(log_selectors.get("include_contains"))
        + _as_list(log_selectors.get("token_patterns"))
    )
    presence = _presence_strength(signals, 0.6, 0.1)
    variant = _variant_strength(profile, player_type, signals + _evidence_texts(player))
    strength = _blend_strength(presence, variant)
    _add_contribution(
        contributions,
        profile,
        "log",
        strength,
        "Log paths and selectors",
        signals,
    )


def _score_window_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    selectors = _selectors(player)
    window_texts = _unique(
        _as_list(selectors.get("window_title_contains"))
        + [
            text.split(":", 1)[1].strip()
            for text in _evidence_texts(player)
            if text.lower().startswith("window title:")
        ]
    )
    presence = _presence_strength(window_texts, 0.56, 0.1)
    variant = _variant_strength(profile, player_type, window_texts)
    strength = _blend_strength(presence, variant)
    _add_contribution(
        contributions,
        profile,
        "window",
        strength,
        "Window-title evidence",
        window_texts,
    )


def _score_startup_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    startup_hits = [
        text for text in _evidence_texts(player) if "startup command" in text.lower()
    ]
    if not startup_hits:
        return
    strength = _blend_strength(0.72, _variant_strength(profile, player_type, startup_hits))
    _add_contribution(
        contributions,
        profile,
        "startup",
        strength,
        "Startup command evidence",
        startup_hits,
    )


def _score_scheduled_task_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    task_hits = [
        text for text in _evidence_texts(player) if "scheduled task" in text.lower()
    ]
    if not task_hits:
        return
    strength = _blend_strength(0.7, _variant_strength(profile, player_type, task_hits))
    _add_contribution(
        contributions,
        profile,
        "scheduled_task",
        strength,
        "Scheduled task evidence",
        task_hits,
    )


def _score_config_evidence(
    player: dict[str, Any],
    player_type: str,
    profile: dict[str, Any],
    contributions: list[dict[str, Any]],
) -> None:
    paths = _paths(player)
    signals = _unique(
        _as_list(paths.get("instance_root"))
        + _as_list(paths.get("admax_state_path"))
        + _as_list(paths.get("settings_ini"))
    )
    presence = _presence_strength(signals, 0.64, 0.08)
    variant = _variant_strength(profile, player_type, signals)
    strength = _blend_strength(presence, variant)
    _add_contribution(
        contributions,
        profile,
        "config",
        strength,
        "Configuration-state paths",
        signals,
    )


def _derive_instance_source(player: dict[str, Any]) -> str:
    selectors = _selectors(player)
    paths = _paths(player)

    for value in (
        _first(_as_list(selectors.get("service_names"))),
        _first(_as_list(selectors.get("command_line_contains"))),
        _first(_as_list(selectors.get("window_title_contains"))),
        _first(_as_list(selectors.get("process_names"))),
        str(paths.get("instance_root") or "").strip(),
        _first(_as_list(paths.get("admax_root_candidates"))),
        str(paths.get("log_path") or "").strip(),
        str(player.get("label") or "").strip(),
        str(player.get("player_id") or "").strip(),
    ):
        if value:
            return value

    return "instance"


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "instance"


def _derive_instance_id(player: dict[str, Any], player_type: str) -> str:
    source = _derive_instance_source(player)
    digest = hashlib.sha256(f"{player_type}|{source.lower()}".encode("utf-8")).hexdigest()[:8]
    return f"{player_type}:{_slug(source)[:48]}:{digest}"


def _parse_command_hint(command_line: str) -> str:
    patterns = (
        ("Channel", r"(?i)(?:^|\s)--?channel(?:=|\s+)([a-z0-9_-]+)"),
        ("Service", r"(?i)(?:^|\s)--?service(?:=|\s+)([a-z0-9_-]+)"),
        ("Instance", r"(?i)(?:^|\s)--?instance(?:=|\s+)([a-z0-9_-]+)"),
    )
    for prefix, pattern in patterns:
        match = re.search(pattern, command_line)
        if match:
            value = match.group(1).strip()
            if value:
                pretty = value.replace("_", " ").replace("-", " ").title()
                return f"{prefix} {pretty}"
    return ""


def _derive_suggested_label(
    player: dict[str, Any],
    player_type: str,
    learning_match: dict[str, Any] | None,
) -> str:
    if learning_match:
        learned_label = str(learning_match.get("instance_label") or "").strip()
        if learned_label:
            return learned_label

    label = str(player.get("label") or "").strip()
    if label:
        return label

    selectors = _selectors(player)
    command_hint = _parse_command_hint(_first(_as_list(selectors.get("command_line_contains"))))
    if command_hint:
        return f"{_profile_label(player_type)} {command_hint}"

    service_name = _first(_as_list(selectors.get("service_display_name_contains"))) or _first(
        _as_list(selectors.get("service_names"))
    )
    if service_name:
        return service_name

    window_title = _first(_as_list(selectors.get("window_title_contains")))
    if window_title:
        return window_title

    return _profile_label(player_type)


def _score_band(confidence: float, thresholds: dict[str, float]) -> str:
    if confidence >= thresholds["high"]:
        return "high"
    if confidence >= thresholds["medium"]:
        return "medium"
    return "low"


def _compute_confidence(
    contributions: list[dict[str, Any]],
    legacy_confidence: float,
    player_type: str,
    learning_match: dict[str, Any] | None,
) -> float:
    confidence = 0.0
    for contribution in contributions:
        confidence = 1.0 - ((1.0 - confidence) * (1.0 - float(contribution["contribution"])))

    if legacy_confidence > 0:
        if len(contributions) >= 2:
            confidence = max(confidence, min(0.95, legacy_confidence * 0.92))
        else:
            confidence = max(confidence, min(0.75, legacy_confidence * 0.78))

    if player_type == GENERIC_PLAYOUT_TYPE and len(contributions) <= 1 and not learning_match:
        confidence = min(confidence, 0.59)

    return round(min(0.99, max(confidence, 0.0)), 2)


def score_player_detection(
    player: dict[str, Any],
    learning_store: LearningStore | None = None,
) -> dict[str, Any]:
    player_type = (
        str(player.get("playout_type") or player.get("player_type") or GENERIC_PLAYOUT_TYPE).strip()
        or GENERIC_PLAYOUT_TYPE
    )
    profile = _profile_for_player_type(player_type)
    thresholds = _confidence_thresholds()
    contributions: list[dict[str, Any]] = []

    _score_process_evidence(player, player_type, profile, contributions)
    _score_service_evidence(player, player_type, profile, contributions)
    _score_registry_evidence(player, player_type, profile, contributions)
    _score_path_evidence(player, player_type, profile, contributions)
    _score_log_evidence(player, player_type, profile, contributions)
    _score_window_evidence(player, player_type, profile, contributions)
    _score_startup_evidence(player, player_type, profile, contributions)
    _score_scheduled_task_evidence(player, player_type, profile, contributions)
    _score_config_evidence(player, player_type, profile, contributions)

    learning_match = None
    if learning_store is not None:
        learned = learning_store.query_by_evidence(player)
        if learned:
            learning_match = learned[0]
            _add_contribution(
                contributions,
                profile,
                "learned",
                1.0,
                "Operator-confirmed learned fingerprint",
                [str(learning_match.get("fingerprint_hash") or "")],
            )

    legacy_confidence = float(_as_mapping(player.get("discovery")).get("confidence") or 0.0)
    confidence = _compute_confidence(contributions, legacy_confidence, player_type, learning_match)
    confidence_band = _score_band(confidence, thresholds)

    return {
        "player_id": str(player.get("player_id") or "").strip(),
        "player_type": player_type,
        "instance_id": _derive_instance_id(player, player_type),
        "confidence": confidence,
        "confidence_band": confidence_band,
        "needs_confirmation": confidence_band != "high",
        "suggested_label": _derive_suggested_label(player, player_type, learning_match),
        "legacy_confidence": round(legacy_confidence, 2),
        "evidence": contributions,
        "learning_match": (
            {
                "fingerprint_hash": learning_match.get("fingerprint_hash"),
                "instance_label": learning_match.get("instance_label"),
                "confirmed_by": learning_match.get("confirmed_by"),
                "confirmed_at": learning_match.get("confirmed_at"),
            }
            if learning_match
            else None
        ),
    }


def score_detection_payload(
    payload: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    learning_store: LearningStore | None = None
    try:
        learning_store = LearningStore(db_path) if db_path else LearningStore()
    except OSError:
        learning_store = None
    players = payload.get("players") if isinstance(payload.get("players"), list) else []
    thresholds = _confidence_thresholds()
    detections = [
        score_player_detection(_as_mapping(player), learning_store=learning_store)
        for player in players
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "thresholds": thresholds,
        "detections": detections,
        "summary": {
            "total": len(detections),
            "high": sum(1 for detection in detections if detection["confidence_band"] == "high"),
            "medium": sum(1 for detection in detections if detection["confidence_band"] == "medium"),
            "low": sum(1 for detection in detections if detection["confidence_band"] == "low"),
            "needs_confirmation": sum(1 for detection in detections if detection["needs_confirmation"]),
        },
    }


def _read_payload(path: str) -> dict[str, Any]:
    if path == "-":
        return json.load(sys.stdin)
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="-")
    parser.add_argument("--db-path", default="")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    payload = _read_payload(args.input)
    result = score_detection_payload(payload, db_path=args.db_path or None)
    output = json.dumps(result, indent=2 if args.pretty else None, sort_keys=bool(args.pretty))
    sys.stdout.write(output)
    if not output.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
