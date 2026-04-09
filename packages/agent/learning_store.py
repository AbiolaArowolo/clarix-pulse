from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _program_data_root() -> Path:
    program_data = os.environ.get("ProgramData") or os.environ.get("PROGRAMDATA")
    if program_data:
        return Path(program_data)

    temp_root = os.environ.get("TEMP") or os.environ.get("TMP")
    if temp_root:
        return Path(temp_root)

    return Path.cwd()


def _local_app_data_root() -> Path:
    local_app_data = os.environ.get("LocalAppData") or os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data)

    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        return Path(user_profile) / "AppData" / "Local"

    return _program_data_root()


DEFAULT_DB_PATH = _program_data_root() / "ClarixPulse" / "learned_fingerprints.db"
FALLBACK_DB_PATH = _local_app_data_root() / "ClarixPulse" / "learned_fingerprints.db"

_PATH_KEYS = (
    "install_dir",
    "instance_root",
    "admax_root",
    "admax_root_candidates",
    "shared_log_dir",
    "log_path",
    "playout_log_dir",
    "fnf_log",
    "playlistscan_log",
    "admax_state_path",
)

_PROCESS_SELECTOR_KEYS = (
    "process_names",
    "executable_path_contains",
    "command_line_contains",
    "window_title_contains",
    "service_names",
    "service_display_name_contains",
    "service_path_contains",
    "process_name_regex",
    "command_line_regex",
    "window_title_regex",
    "service_name_regex",
)


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[str]:
    if isinstance(value, str):
        cleaned = value.strip()
        return [cleaned] if cleaned else []
    if not isinstance(value, list):
        return []

    normalized: list[str] = []
    for entry in value:
        cleaned = str(entry).strip()
        if cleaned:
            normalized.append(cleaned)
    return normalized


def _normalize_text_list(value: Any) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for entry in _as_list(value):
        lowered = entry.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(entry)
    return normalized


def normalize_evidence_payload(evidence_json: Any) -> dict[str, Any]:
    evidence = _as_mapping(evidence_json)
    paths = _as_mapping(evidence.get("paths"))
    process_selectors = _as_mapping(
        evidence.get("process_selectors") or evidence.get("processSelectors")
    )
    discovery = _as_mapping(evidence.get("discovery"))

    normalized_paths: dict[str, Any] = {}
    for key in _PATH_KEYS:
        if key not in paths:
            continue
        value = paths[key]
        if isinstance(value, list):
            cleaned = _normalize_text_list(value)
            if cleaned:
                normalized_paths[key] = cleaned
            continue
        cleaned_text = str(value).strip()
        if cleaned_text:
            normalized_paths[key] = cleaned_text

    normalized_selectors: dict[str, Any] = {}
    for key in _PROCESS_SELECTOR_KEYS:
        if key not in process_selectors:
            continue
        value = process_selectors[key]
        if isinstance(value, list):
            cleaned = _normalize_text_list(value)
            if cleaned:
                normalized_selectors[key] = cleaned
            continue
        cleaned_text = str(value).strip()
        if cleaned_text:
            normalized_selectors[key] = cleaned_text

    normalized_discovery = {
        "evidence": _normalize_text_list(discovery.get("evidence")),
    }

    return {
        "player_type": str(
            evidence.get("playout_type")
            or evidence.get("player_type")
            or "generic_windows"
        ).strip()
        or "generic_windows",
        "label": str(evidence.get("label") or "").strip(),
        "paths": normalized_paths,
        "process_selectors": normalized_selectors,
        "discovery": normalized_discovery,
    }


def fingerprint_hash_for_evidence(evidence_json: Any) -> str:
    normalized = normalize_evidence_payload(evidence_json)
    serialized = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class LearningStore:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = self._resolve_db_path(Path(db_path) if db_path else DEFAULT_DB_PATH)
        self._initialize()

    def _resolve_db_path(self, preferred_path: Path) -> Path:
        candidates = [preferred_path]
        if preferred_path != FALLBACK_DB_PATH:
            candidates.append(FALLBACK_DB_PATH)

        temp_root = os.environ.get("TEMP") or os.environ.get("TMP")
        if temp_root:
            candidates.append(Path(temp_root) / "ClarixPulse" / "learned_fingerprints.db")

        last_error: Exception | None = None
        for candidate in candidates:
            try:
                candidate.parent.mkdir(parents=True, exist_ok=True)
                return candidate
            except OSError as exc:
                last_error = exc

        if last_error is not None:
            raise last_error

        return preferred_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS learned_fingerprints (
                    fingerprint_hash TEXT PRIMARY KEY,
                    player_type TEXT NOT NULL,
                    instance_label TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    confirmed_by TEXT NOT NULL,
                    confirmed_at TEXT NOT NULL
                )
                """
            )
            connection.commit()

    def save_confirmation(
        self,
        player_type: str,
        instance_label: str,
        evidence_json: Any,
        confirmed_by: str = "local-operator",
    ) -> str:
        fingerprint_hash = fingerprint_hash_for_evidence(evidence_json)
        normalized_evidence = normalize_evidence_payload(evidence_json)
        confirmed_at = datetime.now(timezone.utc).isoformat()

        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO learned_fingerprints (
                    fingerprint_hash,
                    player_type,
                    instance_label,
                    evidence_json,
                    confirmed_by,
                    confirmed_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(fingerprint_hash) DO UPDATE SET
                    player_type = excluded.player_type,
                    instance_label = excluded.instance_label,
                    evidence_json = excluded.evidence_json,
                    confirmed_by = excluded.confirmed_by,
                    confirmed_at = excluded.confirmed_at
                """,
                (
                    fingerprint_hash,
                    str(player_type).strip() or "generic_windows",
                    str(instance_label).strip() or "Confirmed Player",
                    json.dumps(normalized_evidence, sort_keys=True),
                    str(confirmed_by).strip() or "local-operator",
                    confirmed_at,
                ),
            )
            connection.commit()

        return fingerprint_hash

    def query_by_evidence(self, evidence_json: Any) -> list[dict[str, Any]]:
        fingerprint_hash = fingerprint_hash_for_evidence(evidence_json)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT fingerprint_hash, player_type, instance_label, evidence_json, confirmed_by, confirmed_at
                FROM learned_fingerprints
                WHERE fingerprint_hash = ?
                ORDER BY confirmed_at DESC
                """,
                (fingerprint_hash,),
            ).fetchall()

        results: list[dict[str, Any]] = []
        for row in rows:
            results.append(
                {
                    "fingerprint_hash": row["fingerprint_hash"],
                    "player_type": row["player_type"],
                    "instance_label": row["instance_label"],
                    "evidence_json": json.loads(row["evidence_json"]),
                    "confirmed_by": row["confirmed_by"],
                    "confirmed_at": row["confirmed_at"],
                }
            )
        return results

    def export_for_hub_sync(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT fingerprint_hash, player_type, instance_label, evidence_json, confirmed_by, confirmed_at
                FROM learned_fingerprints
                ORDER BY confirmed_at DESC
                """
            ).fetchall()

        exported: list[dict[str, Any]] = []
        for row in rows:
            exported.append(
                {
                    "fingerprint_hash": row["fingerprint_hash"],
                    "player_type": row["player_type"],
                    "instance_label": row["instance_label"],
                    "evidence_json": json.loads(row["evidence_json"]),
                    "confirmed_by": row["confirmed_by"],
                    "confirmed_at": row["confirmed_at"],
                }
            )
        return exported
