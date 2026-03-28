from __future__ import annotations

from typing import Any

DEFAULT_PLAYOUT_TYPE = "insta"
GENERIC_PLAYOUT_TYPE = "generic_windows"

PLAYOUT_PROFILES: dict[str, dict[str, str | bool]] = {
    "insta": {
        "label": "Indytek Insta",
        "family": "insta",
        "ui_mode": "insta",
        "native": True,
        "description": "Native Pulse profile using Insta logs plus runningstatus/filebar state files.",
    },
    "admax": {
        "label": "Unimedia Admax",
        "family": "admax",
        "ui_mode": "admax",
        "native": True,
        "description": "Native Pulse profile using Admax playout logs and Settings.ini frame tracking.",
    },
    "cinegy_air": {
        "label": "Cinegy Air",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use activity logs and advanced selectors today; HTTP/API integration can come later.",
    },
    "playbox_neo": {
        "label": "PlayBox Neo AirBox",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use AsRun/system logs and process selectors today; native profile can follow with samples.",
    },
    "grass_valley_itx": {
        "label": "Grass Valley iTX",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use service/process selectors and exported logs today; deeper service-aware support can follow.",
    },
    "imagine_versio": {
        "label": "Imagine Versio",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Best handled with output monitoring plus selectors for now; API/web integration is the long-term path.",
    },
    "broadstream_oasys": {
        "label": "BroadStream OASYS",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use logs, browser-access monitoring hints, and output probes today; native connector later.",
    },
    "pebble_marina": {
        "label": "Pebble Marina",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Best fit is output monitoring plus API/SNMP-aware integration; local log support is optional.",
    },
    "evertz_streampro": {
        "label": "Evertz StreamPro / Overture",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use schedule/export logs and output probes today; deeper Overture-aware support can follow.",
    },
    GENERIC_PLAYOUT_TYPE: {
        "label": "Generic Windows Playout",
        "family": "generic",
        "ui_mode": "generic",
        "native": False,
        "description": "Use local logs, process/window selectors, and output probes for any unsupported playout app.",
    },
}

PLAYOUT_TYPE_ALIASES = {
    "airbox": "playbox_neo",
    "airbox_neo": "playbox_neo",
    "broadstream": "broadstream_oasys",
    "cinegy": "cinegy_air",
    "custom": GENERIC_PLAYOUT_TYPE,
    "evertz": "evertz_streampro",
    "generic": GENERIC_PLAYOUT_TYPE,
    "grassvalley_itx": "grass_valley_itx",
    "itx": "grass_valley_itx",
    "marina": "pebble_marina",
    "oasys": "broadstream_oasys",
    "overture": "evertz_streampro",
    "playbox": "playbox_neo",
    "playboxneo": "playbox_neo",
    "streampro": "evertz_streampro",
    "versio": "imagine_versio",
}


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
    ordered_ids = [
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
    return [
        {"id": profile_id, **PLAYOUT_PROFILES[profile_id]}
        for profile_id in ordered_ids
    ]
