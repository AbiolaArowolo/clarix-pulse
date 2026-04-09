from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

DEFAULT_PLAYOUT_TYPE = "insta"
GENERIC_PLAYOUT_TYPE = "generic_windows"

_FALLBACK_PROFILE_ORDER = [
    "insta",
    "admax",
    "cinegy_air",
    "playbox_neo",
    "grass_valley_itx",
    "imagine_versio",
    "broadstream_oasys",
    "pebble_marina",
    "evertz_streampro",
    GENERIC_PLAYOUT_TYPE,
]

_FALLBACK_PROFILES: dict[str, dict[str, Any]] = {
    "insta": {
        "label": "Indytek Insta",
        "family": "insta",
        "ui_mode": "insta",
        "native": True,
        "description": "Native Pulse profile using Insta logs plus runningstatus/filebar state files.",
        "aliases": ["insta"],
        "known_variants": ["indytek", "insta playout"],
    },
    "admax": {
        "label": "Unimedia Admax",
        "family": "admax",
        "ui_mode": "admax",
        "native": True,
        "description": "Native Pulse profile using Admax playout logs and Settings.ini frame tracking.",
        "aliases": ["admax"],
        "known_variants": ["unimedia", "admax"],
    },
    "cinegy_air": {
        "label": "Cinegy Air",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use activity logs and advanced selectors today; HTTP/API integration can come later.",
        "aliases": ["cinegy", "cinegy_air"],
        "known_variants": ["cinegy", "air"],
    },
    "playbox_neo": {
        "label": "PlayBox Neo AirBox",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use AsRun/system logs and process selectors today; native profile can follow with samples.",
        "aliases": ["airbox", "airbox_neo", "playbox", "playboxneo", "playbox_neo"],
        "known_variants": ["playbox", "airbox"],
    },
    "grass_valley_itx": {
        "label": "Grass Valley iTX",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use service/process selectors and exported logs today; deeper service-aware support can follow.",
        "aliases": ["grassvalley_itx", "grass_valley_itx", "itx"],
        "known_variants": ["grass valley", "itx"],
    },
    "imagine_versio": {
        "label": "Imagine Versio",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Best handled with output monitoring plus selectors for now; API/web integration is the long-term path.",
        "aliases": ["imagine_versio", "versio"],
        "known_variants": ["imagine", "versio"],
    },
    "broadstream_oasys": {
        "label": "BroadStream OASYS",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use logs, browser-access monitoring hints, and output probes today; native connector later.",
        "aliases": ["broadstream", "broadstream_oasys", "oasys"],
        "known_variants": ["broadstream", "oasys"],
    },
    "pebble_marina": {
        "label": "Pebble Marina",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Best fit is output monitoring plus API/SNMP-aware integration; local log support is optional.",
        "aliases": ["marina", "pebble_marina"],
        "known_variants": ["pebble", "marina"],
    },
    "evertz_streampro": {
        "label": "Evertz StreamPro / Overture",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use schedule/export logs and output probes today; deeper Overture-aware support can follow.",
        "aliases": ["evertz", "evertz_streampro", "overture", "streampro"],
        "known_variants": ["evertz", "streampro", "overture"],
    },
    GENERIC_PLAYOUT_TYPE: {
        "label": "Generic Windows Playout",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use local logs, process/window selectors, and output probes for any unsupported playout app.",
        "aliases": ["custom", "generic", GENERIC_PLAYOUT_TYPE],
        "known_variants": ["playout", "broadcast", "automation"],
    },
}


def _module_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def _load_manifest_profiles() -> tuple[dict[str, dict[str, Any]], list[str]]:
    manifest_path = _module_root() / "fingerprint_manifest.json"
    if manifest_path.is_file():
        try:
            document = json.loads(manifest_path.read_text(encoding="utf-8"))
            raw_profiles = document.get("profiles")
            if isinstance(raw_profiles, list):
                profiles: dict[str, dict[str, Any]] = {}
                order: list[str] = []
                for raw_profile in raw_profiles:
                    if not isinstance(raw_profile, dict):
                        continue
                    profile_id = str(raw_profile.get("id") or raw_profile.get("player_type") or "").strip()
                    if not profile_id:
                        continue
                    profiles[profile_id] = {
                        "label": str(raw_profile.get("label") or profile_id),
                        "family": str(raw_profile.get("family") or "generic"),
                        "ui_mode": str(raw_profile.get("ui_mode") or "generic"),
                        "native": bool(raw_profile.get("native")),
                        "description": str(raw_profile.get("description") or ""),
                        "aliases": [
                            str(alias).strip()
                            for alias in raw_profile.get("aliases", [])
                            if str(alias).strip()
                        ],
                        "known_variants": [
                            str(variant).strip()
                            for variant in raw_profile.get("known_variants", [])
                            if str(variant).strip()
                        ],
                    }
                    order.append(profile_id)

                if profiles:
                    return profiles, order
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    return dict(_FALLBACK_PROFILES), list(_FALLBACK_PROFILE_ORDER)


def _build_alias_map(profiles: dict[str, dict[str, Any]]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for profile_id, profile in profiles.items():
        candidates = [profile_id, *profile.get("aliases", []), *profile.get("known_variants", [])]
        for candidate in candidates:
            normalized = str(candidate).strip().lower().replace(" ", "_").replace("-", "_")
            if normalized:
                aliases[normalized] = profile_id
    return aliases


_LOADED_PROFILES, _PROFILE_ORDER = _load_manifest_profiles()
PLAYOUT_PROFILES: dict[str, dict[str, str | bool]] = {
    profile_id: {
        "label": str(profile.get("label") or profile_id),
        "family": str(profile.get("family") or "generic"),
        "ui_mode": str(profile.get("ui_mode") or "generic"),
        "native": bool(profile.get("native")),
        "description": str(profile.get("description") or ""),
    }
    for profile_id, profile in _LOADED_PROFILES.items()
}
PLAYOUT_TYPE_ALIASES = _build_alias_map(_LOADED_PROFILES)


def normalize_playout_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return DEFAULT_PLAYOUT_TYPE

    normalized = raw.replace(" ", "_").replace("-", "_")
    normalized = PLAYOUT_TYPE_ALIASES.get(normalized, normalized)
    if normalized in PLAYOUT_PROFILES:
        return normalized
    return GENERIC_PLAYOUT_TYPE


def get_playout_profile(value: Any) -> dict[str, str | bool]:
    return PLAYOUT_PROFILES[normalize_playout_type(value)]


def playout_family(value: Any) -> str:
    profile = get_playout_profile(value)
    return str(profile.get("family") or "generic")


def playout_profiles_for_ui() -> list[dict[str, str | bool]]:
    ordered_ids = [profile_id for profile_id in _PROFILE_ORDER if profile_id in PLAYOUT_PROFILES]
    if GENERIC_PLAYOUT_TYPE not in ordered_ids and GENERIC_PLAYOUT_TYPE in PLAYOUT_PROFILES:
        ordered_ids.append(GENERIC_PLAYOUT_TYPE)

    return [
        {"id": profile_id, **PLAYOUT_PROFILES[profile_id]}
        for profile_id in ordered_ids
    ]
