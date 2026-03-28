"""
Pulse - Local Monitoring Agent.
Can run as a local installer/configurator in an interactive session and as a
monitoring loop when launched by the Windows service. Polls every N seconds,
POSTs one heartbeat per player to the hub. Sends raw observations only - hub
computes health state.
"""

import ctypes
import copy
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
import threading
import traceback
import webbrowser
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
LOCAL_UI_HOST = "127.0.0.1"
LOCAL_UI_PORT = 3210
DEFAULT_INSTA_LOG_DIR = r"C:\Program Files\Indytek\Insta log"
DEFAULT_INSTA_INSTANCE_ROOT = r"C:\Program Files\Indytek\Insta Playout\Settings"
NSSM_PACKAGE_URL = "https://community.chocolatey.org/api/v2/package/nssm"
FFMPEG_ARCHIVE_URL = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
    "ffmpeg-n8.0-latest-win64-gpl-8.0.zip"
)
LOCAL_CONFIG_UI_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pulse Local Setup</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09121f;
      --panel: #111c2d;
      --panel-soft: #0e1726;
      --line: #22314a;
      --text: #e6edf7;
      --muted: #8ea1bd;
      --accent: #14b8a6;
      --danger: #ef4444;
      --warn: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(circle at top, #10233a, var(--bg) 56%);
      color: var(--text);
    }
    .shell {
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero, .panel, .player, .udp {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(17,28,45,0.98), rgba(9,18,31,0.96));
      border-radius: 20px;
    }
    .hero, .panel { padding: 18px; }
    .hero h1 {
      margin: 0;
      font-size: 28px;
    }
    .hero p {
      margin: 8px 0 0;
      color: var(--muted);
      line-height: 1.5;
    }
    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      margin-top: 18px;
    }
    .stack {
      display: grid;
      gap: 14px;
      margin-top: 18px;
    }
    .player, .udp { padding: 16px; }
    .player-header, .row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      background: #08111d;
      color: var(--text);
      font-size: 14px;
    }
    input[type="checkbox"] {
      width: auto;
      accent-color: var(--accent);
    }
    .checkbox {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      text-transform: none;
      letter-spacing: normal;
      color: var(--text);
    }
    button {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 16px;
      background: #10243c;
      color: var(--text);
      cursor: pointer;
      font-weight: 600;
    }
    button.primary {
      background: rgba(20,184,166,0.16);
      border-color: rgba(20,184,166,0.5);
    }
    button.warn {
      background: rgba(245,158,11,0.16);
      border-color: rgba(245,158,11,0.5);
    }
    button.danger {
      background: rgba(239,68,68,0.16);
      border-color: rgba(239,68,68,0.5);
    }
    button.toggle-on {
      background: rgba(16,185,129,0.16);
      border-color: rgba(16,185,129,0.45);
      color: #d1fae5;
    }
    button.toggle-off {
      background: rgba(148,163,184,0.12);
      border-color: rgba(148,163,184,0.35);
      color: var(--muted);
    }
    .udp-disabled {
      opacity: 0.72;
    }
    .status-note {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 14px;
      color: var(--muted);
      background: rgba(9,18,31,0.5);
      font-size: 13px;
      text-transform: none;
      letter-spacing: normal;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .meta {
      font-size: 13px;
      color: var(--muted);
    }
    .notice, .error {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
    }
    .notice { background: rgba(20,184,166,0.12); color: #d5fff8; }
    .error { background: rgba(239,68,68,0.12); color: #ffd7d7; }
    .muted-card {
      padding: 14px;
      border: 1px dashed var(--line);
      border-radius: 16px;
      color: var(--muted);
      background: rgba(8,17,29,0.55);
    }
    .section-title {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <h1>Pulse Local Setup</h1>
      <p>
        This node is configured here first. The web app mirrors these settings for remote visibility,
        but the live configuration stays on the node.
      </p>
    </section>

    <section class="panel">
      <h2 class="section-title">Node</h2>
      <div class="grid">
        <label>Node ID<input id="node_id"></label>
        <label>Node Name<input id="node_name"></label>
        <label>Site ID<input id="site_id"></label>
        <label>Hub URL<input id="hub_url"></label>
        <label>Agent Token<input id="agent_token"></label>
        <label>Poll Interval (Seconds)<input id="poll_interval_seconds" type="number" min="1" max="120"></label>
      </div>
    </section>

    <section class="panel">
      <div class="row">
        <h2 class="section-title">Players</h2>
        <button type="button" class="primary" onclick="PulseUi.addPlayer()">+ Add player</button>
      </div>
      <div id="players" class="stack"></div>
    </section>

    <div class="actions">
      <button type="button" class="primary" onclick="PulseUi.save()">Save Local Settings</button>
      <button type="button" class="warn" onclick="PulseUi.reload()">Reload from disk</button>
    </div>
    <div id="notice" class="notice" style="display:none;"></div>
    <div id="error" class="error" style="display:none;"></div>
  </div>

  <script>
    const INITIAL_STATE = __INITIAL_CONFIG__;
    const MAX_PLAYERS = 10;
    const MAX_UDP = 5;
    const DEFAULTS = {
      instaLogDir: "C:\\Program Files\\Indytek\\Insta log",
      instaRoot: "C:\\Program Files\\Indytek\\Insta Playout\\Settings",
      hubUrl: "https://monitor.example.com"
    };

    let state = structuredClone(INITIAL_STATE);

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function showMessage(kind, text) {
      const notice = document.getElementById("notice");
      const error = document.getElementById("error");
      notice.style.display = "none";
      error.style.display = "none";
      if (!text) return;
      const target = kind === "error" ? error : notice;
      target.textContent = text;
      target.style.display = "block";
    }

    function defaultPlayer(index) {
      const playoutType = "insta";
      const playerId = `${state.node_id || "node"}-${playoutType}-${index + 1}`;
      return {
        player_id: playerId,
        playout_type: playoutType,
        paths: {
          shared_log_dir: DEFAULTS.instaLogDir,
          instance_root: DEFAULTS.instaRoot
        },
        udp_inputs: []
      };
    }

    function defaultUdpInput(playerId, index) {
      return {
        udp_input_id: `${playerId || "player"}-udp-${index + 1}`,
        enabled: false,
        stream_url: "",
        thumbnail_interval_s: 10
      };
    }

    function renderTop() {
      document.getElementById("node_id").value = state.node_id || "";
      document.getElementById("node_name").value = state.node_name || "";
      document.getElementById("site_id").value = state.site_id || "";
      document.getElementById("hub_url").value = state.hub_url || DEFAULTS.hubUrl;
      document.getElementById("agent_token").value = state.agent_token || "";
      document.getElementById("poll_interval_seconds").value = state.poll_interval_seconds || 5;
    }

    function renderPlayers() {
      const container = document.getElementById("players");
      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length === 0) {
        container.innerHTML = '<div class="muted-card">No players added yet.</div>';
        return;
      }

      container.innerHTML = players.map((player, playerIndex) => {
        const udpInputs = Array.isArray(player.udp_inputs) ? player.udp_inputs : [];
        const isInsta = (player.playout_type || "insta") === "insta";
        const pathHtml = isInsta
          ? `
            <div class="grid">
              <label>Shared Log Dir
                <input value="${escapeHtml(player.paths?.shared_log_dir || DEFAULTS.instaLogDir)}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'shared_log_dir', this.value)">
              </label>
              <label>Instance Root
                <input value="${escapeHtml(player.paths?.instance_root || DEFAULTS.instaRoot)}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'instance_root', this.value)">
              </label>
            </div>
          `
          : `
            <div class="grid">
              <label>Admax Root
                <input value="${escapeHtml((player.paths?.admax_root_candidates && player.paths.admax_root_candidates[0]) || player.paths?.admax_root || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'admax_root', this.value)">
              </label>
            </div>
          `;

        const udpHtml = udpInputs.length === 0
          ? '<div class="muted-card">No streams added for this player.</div>'
          : udpInputs.map((udp, udpIndex) => `
              <div class="udp ${udp.enabled ? '' : 'udp-disabled'}">
                <div class="row">
                  <strong>Stream ${udpIndex + 1}</strong>
                  <div class="row">
                    <button type="button" class="${udp.enabled ? 'toggle-on' : 'toggle-off'}" onclick="PulseUi.toggleUdpEnabled(${playerIndex}, ${udpIndex})">
                      ${udp.enabled ? 'Monitoring on' : 'Monitoring off'}
                    </button>
                    <button type="button" class="danger" onclick="PulseUi.removeUdp(${playerIndex}, ${udpIndex})">Remove</button>
                  </div>
                </div>
                <div class="grid" style="margin-top:12px;">
                  <label>Stream ID
                    <input value="${escapeHtml(udp.udp_input_id || `${player.player_id}-udp-${udpIndex + 1}`)}" oninput="PulseUi.updateUdp(${playerIndex}, ${udpIndex}, 'udp_input_id', this.value)">
                  </label>
                  <label>Thumbnail Interval (Seconds)
                    <input type="number" min="1" max="300" value="${escapeHtml(udp.thumbnail_interval_s || 10)}" ${udp.enabled ? '' : 'disabled'} oninput="PulseUi.updateUdp(${playerIndex}, ${udpIndex}, 'thumbnail_interval_s', this.value)">
                  </label>
                </div>
                <div class="grid" style="margin-top:12px;">
                  <label>Stream URL
                    <input value="${escapeHtml(udp.stream_url || '')}" oninput="PulseUi.updateUdp(${playerIndex}, ${udpIndex}, 'stream_url', this.value)">
                  </label>
                </div>
                <div class="status-note">
                  ${udp.enabled ? 'This stream is active on the node and Pulse will monitor it.' : 'This stream is saved locally but disabled. Pulse will not monitor it until you turn monitoring on.'}
                </div>
              </div>
            `).join("");

        return `
          <div class="player">
            <div class="player-header">
              <div>
                <strong>Player ${playerIndex + 1}</strong>
                <div class="meta">${escapeHtml(player.player_id || '')}</div>
              </div>
              <button type="button" class="danger" onclick="PulseUi.removePlayer(${playerIndex})">Remove player</button>
            </div>
            <div class="grid" style="margin-top:12px;">
              <label>Player ID
                <input value="${escapeHtml(player.player_id || '')}" oninput="PulseUi.updatePlayer(${playerIndex}, 'player_id', this.value)">
              </label>
              <label>Playout Type
                <select onchange="PulseUi.updatePlayer(${playerIndex}, 'playout_type', this.value)">
                  <option value="insta" ${(player.playout_type || "insta") === "insta" ? "selected" : ""}>Insta</option>
                  <option value="admax" ${player.playout_type === "admax" ? "selected" : ""}>Admax</option>
                </select>
              </label>
            </div>
            <div style="margin-top:14px;">${pathHtml}</div>
            <div class="row" style="margin-top:16px;">
              <h3 class="section-title">Streams</h3>
              <button type="button" class="primary" onclick="PulseUi.addUdp(${playerIndex})">+ Add stream</button>
            </div>
            <div class="stack" style="margin-top:12px;">${udpHtml}</div>
          </div>
        `;
      }).join("");
    }

    function render() {
      renderTop();
      renderPlayers();
    }

    function wireTopInputs() {
      ["node_id", "node_name", "site_id", "hub_url", "agent_token", "poll_interval_seconds"].forEach((field) => {
        document.getElementById(field).addEventListener("input", (event) => {
          state[field] = event.target.value;
        });
      });
    }

    window.PulseUi = {
      updatePlayer(index, key, value) {
        state.players[index][key] = value;
        if (key === "playout_type") {
          state.players[index].paths = value === "admax"
            ? { admax_root_candidates: [""] }
            : { shared_log_dir: DEFAULTS.instaLogDir, instance_root: DEFAULTS.instaRoot };
        }
        renderPlayers();
      },
      updatePlayerPath(index, key, value) {
        const player = state.players[index];
        player.paths = player.paths || {};
        if (key === "admax_root") {
          player.paths.admax_root_candidates = [value];
          delete player.paths.admax_root;
        } else {
          player.paths[key] = value;
        }
      },
      addPlayer() {
        if ((state.players || []).length >= MAX_PLAYERS) return;
        state.players = Array.isArray(state.players) ? state.players : [];
        state.players.push(defaultPlayer(state.players.length));
        renderPlayers();
      },
      removePlayer(index) {
        state.players.splice(index, 1);
        renderPlayers();
      },
      addUdp(playerIndex) {
        const player = state.players[playerIndex];
        player.udp_inputs = Array.isArray(player.udp_inputs) ? player.udp_inputs : [];
        if (player.udp_inputs.length >= MAX_UDP) return;
        player.udp_inputs.push(defaultUdpInput(player.player_id, player.udp_inputs.length));
        renderPlayers();
      },
      removeUdp(playerIndex, udpIndex) {
        state.players[playerIndex].udp_inputs.splice(udpIndex, 1);
        renderPlayers();
      },
      toggleUdpEnabled(playerIndex, udpIndex) {
        const udp = state.players[playerIndex].udp_inputs[udpIndex];
        udp.enabled = !udp.enabled;
        renderPlayers();
      },
      updateUdp(playerIndex, udpIndex, key, value) {
        const udp = state.players[playerIndex].udp_inputs[udpIndex];
        udp[key] = key === "thumbnail_interval_s" ? Number(value) : value;
      },
      async save() {
        showMessage("", "");
        const response = await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state)
        });
        const payload = await response.json();
        if (!response.ok) {
          showMessage("error", payload.error || "Unable to save local settings.");
          return;
        }
        state = payload.config;
        render();
        showMessage("notice", "Local settings saved. Pulse will mirror these to the web app on the next heartbeat.");
      },
      async reload() {
        showMessage("", "");
        const response = await fetch("/api/config");
        const payload = await response.json();
        state = payload;
        render();
      }
    };

    render();
    wireTopInputs();
  </script>
</body>
</html>
"""


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

    raw_stream_url = _as_str(udp_input.get("stream_url", udp_input.get("streamUrl")))
    if "REPLACE_ME" in raw_stream_url:
        raw_stream_url = ""

    return {
        "udp_input_id": udp_input_id,
        "enabled": _as_bool(udp_input.get("enabled"), False),
        "stream_url": udp_probe.normalize_stream_url(raw_stream_url),
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
    fd, temp_path = tempfile.mkstemp(prefix="pulse-config-", suffix=".yaml", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=False)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass


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
        enabled = _as_bool(value.get("enabled"), True)
        return any(
            key != "stream_url" or enabled
            for key, item in value.items()
            if _contains_placeholder(item)
        )
    if isinstance(value, list):
        return any(_contains_placeholder(item) for item in value)
    return False


def _default_player_paths(playout_type: str, existing_paths: dict[str, Any] | None = None) -> dict[str, Any]:
    existing_paths = existing_paths or {}
    if playout_type == "admax":
        admax_root = _as_str(existing_paths.get("admax_root"))
        if not admax_root:
            candidates = existing_paths.get("admax_root_candidates")
            if isinstance(candidates, list) and candidates:
                admax_root = _as_str(candidates[0])
        return {
            "admax_root_candidates": [admax_root],
        }

    return {
        "shared_log_dir": _as_str(existing_paths.get("shared_log_dir"), DEFAULT_INSTA_LOG_DIR),
        "instance_root": _as_str(existing_paths.get("instance_root"), DEFAULT_INSTA_INSTANCE_ROOT),
    }


def _build_default_player_for_ui(index: int, node_id: str, existing_player: dict[str, Any] | None = None) -> dict[str, Any]:
    existing_player = existing_player or {}
    existing_type = _as_str(existing_player.get("playout_type"), "insta").lower()
    playout_type = existing_type if existing_type in {"insta", "admax"} else "insta"
    player_id = _as_str(existing_player.get("player_id"), _default_player_id(node_id, playout_type, index))
    existing_paths = _as_mapping(existing_player.get("paths"))

    udp_inputs = _sync_udp_inputs(player_id, existing_player.get("udp_inputs", []))

    return {
        "player_id": player_id,
        "playout_type": playout_type,
        "paths": _default_player_paths(playout_type, existing_paths),
        "udp_inputs": udp_inputs,
    }


def _config_for_local_ui(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing or {}
    node_id = _as_str(existing.get("node_id"), socket.gethostname().lower().replace(" ", "-"))
    existing_players = existing.get("players") if isinstance(existing.get("players"), list) else []
    if not existing_players and isinstance(existing.get("instances"), list):
        existing_players = existing.get("instances", [])

    players = [
        _build_default_player_for_ui(index, node_id, player if isinstance(player, dict) else {})
        for index, player in enumerate(existing_players)
    ]
    if not players:
        players = [_build_default_player_for_ui(0, node_id, {})]

    return {
        "node_id": node_id,
        "node_name": _as_str(existing.get("node_name"), socket.gethostname()),
        "site_id": _as_str(existing.get("site_id"), _default_site_id(node_id)),
        "hub_url": _as_str(existing.get("hub_url"), DEFAULT_HUB_URL),
        "agent_token": _as_str(existing.get("agent_token")),
        "poll_interval_seconds": max(1, _as_int(existing.get("poll_interval_seconds"), 5)),
        "players": players,
    }


def _normalize_local_ui_submission(payload: Any, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Invalid local configuration payload.")

    existing = copy.deepcopy(existing or {})
    node_id = _as_str(payload.get("node_id"), socket.gethostname().lower().replace(" ", "-"))
    node_name = _as_str(payload.get("node_name"), socket.gethostname())
    site_id = _as_str(payload.get("site_id"), _default_site_id(node_id))
    hub_url = _as_str(payload.get("hub_url"), DEFAULT_HUB_URL)
    agent_token = _as_str(payload.get("agent_token"))
    poll_interval_seconds = max(1, min(120, _as_int(payload.get("poll_interval_seconds"), 5)))

    if not node_id:
        raise ValueError("Node ID is required.")
    if not node_name:
        raise ValueError("Node name is required.")
    if not site_id:
        raise ValueError("Site ID is required.")
    if not hub_url:
        raise ValueError("Hub URL is required.")
    if not agent_token:
        raise ValueError("Agent token is required.")

    players_raw = payload.get("players")
    if not isinstance(players_raw, list) or not players_raw:
        raise ValueError("Add at least one player.")
    if len(players_raw) > 10:
        raise ValueError("Pulse supports up to 10 players per node.")

    existing_players = existing.get("players") if isinstance(existing.get("players"), list) else []
    merged_players: list[dict[str, Any]] = []

    for index, raw_player in enumerate(players_raw):
        if not isinstance(raw_player, dict):
            continue

        playout_type = _as_str(raw_player.get("playout_type"), "insta").lower()
        if playout_type not in {"insta", "admax"}:
            playout_type = "insta"

        player_id = _as_str(raw_player.get("player_id"), _default_player_id(node_id, playout_type, index))
        if not player_id:
            raise ValueError(f"Player {index + 1} needs an ID.")

        existing_player = next(
            (
                player for player in existing_players
                if isinstance(player, dict) and _as_str(player.get("player_id")) == player_id
            ),
            existing_players[index] if index < len(existing_players) and isinstance(existing_players[index], dict) else {},
        )
        merged_player = copy.deepcopy(existing_player) if isinstance(existing_player, dict) else {}
        merged_player["player_id"] = player_id
        merged_player["playout_type"] = playout_type

        raw_paths = _as_mapping(raw_player.get("paths"))
        if playout_type == "admax":
            admax_root = _as_str(raw_paths.get("admax_root"))
            if not admax_root:
                candidates = raw_paths.get("admax_root_candidates")
                if isinstance(candidates, list) and candidates:
                    admax_root = _as_str(candidates[0])
            if not admax_root:
                raise ValueError(f"{player_id} needs an Admax root.")
            merged_player["paths"] = {
                **_as_mapping(merged_player.get("paths")),
                "admax_root_candidates": [admax_root],
            }
        else:
            shared_log_dir = _as_str(raw_paths.get("shared_log_dir"), DEFAULT_INSTA_LOG_DIR)
            instance_root = _as_str(raw_paths.get("instance_root"), DEFAULT_INSTA_INSTANCE_ROOT)
            if not shared_log_dir or not instance_root:
                raise ValueError(f"{player_id} needs both Insta paths.")
            merged_player["paths"] = {
                **_as_mapping(merged_player.get("paths")),
                "shared_log_dir": shared_log_dir,
                "instance_root": instance_root,
            }

        udp_inputs_raw = raw_player.get("udp_inputs")
        if udp_inputs_raw is None:
            udp_inputs_raw = []
        if not isinstance(udp_inputs_raw, list):
            raise ValueError(f"{player_id} has invalid stream settings.")

        udp_inputs: list[dict[str, Any]] = []
        for udp_index, udp_input in enumerate(udp_inputs_raw[:5]):
            if not isinstance(udp_input, dict):
                continue
            normalized_input = _normalize_udp_input(player_id, udp_input, udp_index)
            if normalized_input is None:
                continue
            if _as_bool(normalized_input.get("enabled"), False) and not _as_str(normalized_input.get("stream_url")):
                raise ValueError(f"{player_id} has an enabled stream without a URL.")
            if _as_bool(normalized_input.get("enabled"), False) or _as_str(normalized_input.get("stream_url")):
                udp_inputs.append(normalized_input)

        merged_player["udp_inputs"] = udp_inputs
        merged_player.pop("udp_probe", None)
        merged_players.append(merged_player)

    if not merged_players:
        raise ValueError("Add at least one valid player.")

    existing["node_id"] = node_id
    existing["node_name"] = node_name
    existing["site_id"] = site_id
    existing["hub_url"] = hub_url
    existing["agent_token"] = agent_token
    existing["poll_interval_seconds"] = poll_interval_seconds
    existing["players"] = merged_players
    existing.pop("instances", None)
    return existing


def _render_local_config_ui_html(initial_config: dict[str, Any]) -> bytes:
    initial_json = json.dumps(initial_config, ensure_ascii=True)
    return LOCAL_CONFIG_UI_TEMPLATE.replace("__INITIAL_CONFIG__", initial_json).encode("utf-8")


_persistent_local_ui_lock = threading.Lock()
_persistent_local_ui_started = False


def _local_ui_url() -> str:
    return f"http://{LOCAL_UI_HOST}:{LOCAL_UI_PORT}/"


def _current_local_ui_config() -> dict[str, Any]:
    existing = _load_yaml_if_exists(_runtime_config_path())
    return _config_for_local_ui(existing)


def _save_local_ui_config(payload: dict[str, Any]) -> dict[str, Any]:
    config_path = _runtime_config_path()
    existing = _load_yaml_if_exists(config_path)
    config = _normalize_local_ui_submission(payload, existing)
    _write_yaml(config_path, config)

    udp_enabled = any(
        _as_bool(udp_input.get("enabled"), False)
        for player in config.get("players", [])
        if isinstance(player, dict)
        for udp_input in player.get("udp_inputs", [])
        if isinstance(udp_input, dict)
    )
    _ensure_ff_tools(required=udp_enabled)

    return _config_for_local_ui(config)


def _start_persistent_local_ui_server() -> None:
    global _persistent_local_ui_started

    with _persistent_local_ui_lock:
        if _persistent_local_ui_started:
            return

        class PersistentConfigUiHandler(BaseHTTPRequestHandler):
            server_version = "PulseLocalUI/1.0"

            def log_message(self, format: str, *args: Any) -> None:
                return

            def _send_json(self, status: int, payload: dict[str, Any]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path == "/":
                    html = _render_local_config_ui_html(_current_local_ui_config())
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(html)))
                    self.end_headers()
                    self.wfile.write(html)
                    return

                if self.path == "/api/config":
                    self._send_json(200, _current_local_ui_config())
                    return

                self._send_json(404, {"error": "Not found"})

            def do_POST(self) -> None:
                if self.path != "/api/save":
                    self._send_json(404, {"error": "Not found"})
                    return

                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length)

                try:
                    payload = json.loads(raw_body.decode("utf-8"))
                    config = _save_local_ui_config(payload)
                except Exception as exc:
                    self._send_json(400, {"error": str(exc)})
                    return

                self._send_json(200, {"ok": True, "config": config})

        try:
            server = ThreadingHTTPServer((LOCAL_UI_HOST, LOCAL_UI_PORT), PersistentConfigUiHandler)
        except OSError as exc:
            log.warning(f"Persistent local UI unavailable on {_local_ui_url()}: {exc}")
            return

        thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.2},
            daemon=True,
            name="PulseLocalUI",
        )
        thread.start()
        _persistent_local_ui_started = True
        log.info(f"Persistent local UI available at {_local_ui_url()}")


def _run_local_config_ui(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    initial_config = _config_for_local_ui(existing)
    html = _render_local_config_ui_html(initial_config)
    result: dict[str, Any] = {}
    saved = threading.Event()

    class ConfigUiHandler(BaseHTTPRequestHandler):
        server_version = "PulseLocalUI/1.0"

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
                return

            if self.path == "/api/config":
                self._send_json(200, initial_config)
                return

            self._send_json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/api/save":
                self._send_json(404, {"error": "Not found"})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)

            try:
                payload = json.loads(raw_body.decode("utf-8"))
                config = _normalize_local_ui_submission(payload, existing)
            except Exception as exc:
                self._send_json(400, {"error": str(exc)})
                return

            result["config"] = config
            initial_config.clear()
            initial_config.update(_config_for_local_ui(config))
            self._send_json(200, {"ok": True, "config": initial_config})

            def _shutdown() -> None:
                saved.set()
                self.server.shutdown()

            threading.Thread(target=_shutdown, daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", 0), ConfigUiHandler)
    server.timeout = 1
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print()
    print("Pulse local setup is opening in your browser.")
    print(f"If it does not open automatically, visit: {url}")

    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
    thread.start()

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        while thread.is_alive() and not saved.is_set():
            thread.join(timeout=0.5)
    finally:
        try:
            server.server_close()
        except OSError:
            pass

    if "config" not in result:
        raise RuntimeError("Local setup was closed before settings were saved.")

    return result["config"]


def _run_config_editor(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return _run_local_config_ui(existing)
    except Exception as exc:
        print(f"Local setup UI was unavailable: {exc}")
        print("Falling back to the console wizard.")
        return _run_config_wizard(existing)


def open_local_ui_command() -> int:
    url = _local_ui_url()

    try:
        response = requests.get(url, timeout=2)
        if response.status_code >= 400:
            raise requests.RequestException(f"Unexpected HTTP {response.status_code}")
    except requests.RequestException:
        print(f"Persistent local UI is not running at {url}")
        return 2

    try:
        webbrowser.open(url)
    except Exception as exc:
        print(f"Unable to open your browser automatically: {exc}")
        print(f"Open this URL manually: {url}")
        return 1

    print(f"Pulse local UI opened at {url}")
    return 0


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
    configured = _run_config_editor(existing)
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
        print(f"Local UI: {_local_ui_url()}")
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
        configured = _run_config_editor(existing)
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
    node_config_mirror: dict[str, Any] | None = None,
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
    if node_config_mirror is not None:
        payload["nodeConfigMirror"] = node_config_mirror
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
    configured_count = 0
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

        if not enabled:
            entry["skipped"] = True
            matrix.append(entry)
            continue

        if not stream_url:
            entry["error"] = "missing stream_url"
            matrix.append(entry)
            continue

        configured_count += 1

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

    return matrix, primary, configured_count, healthy_count


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


def _build_node_config_mirror(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "node_id": config["node_id"],
        "node_name": config["node_name"],
        "site_id": config.get("site_id", ""),
        "hub_url": config["hub_url"],
        "poll_interval_seconds": int(config.get("poll_interval_seconds", 10)),
        "players": [
            {
                "player_id": player["player_id"],
                "playout_type": player.get("playout_type", "insta"),
                "paths": player.get("paths", {}),
                "udp_inputs": player.get("udp_inputs", []),
            }
            for player in config.get("players", [])
            if isinstance(player, dict) and player.get("player_id")
        ],
    }


def poll_player(
    node_id: str,
    hub_url: str,
    token: str,
    player: dict[str, Any],
    node_config_mirror: dict[str, Any] | None = None,
) -> None:
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
    response_payload = post_heartbeat(
        hub_url,
        token,
        node_id,
        player_id,
        observations,
        node_config_mirror=node_config_mirror,
    )
    if response_payload is not None:
        log.debug(f"[{player_id}] heartbeat OK — {observations}")

    # POST thumbnail if captured
    if thumbnail_data_url and thumbnail_udp_input_id:
        post_thumbnail(hub_url, token, node_id, player_id, thumbnail_udp_input_id, thumbnail_data_url)

    return None


# --- Main loop ----------------------------------------------------------------

def run_agent_loop() -> int:
    config_path = _runtime_config_path()
    last_config_signature = ""

    while True:
        config = load_config(config_path)
        _start_persistent_local_ui_server()

        node_id = config["node_id"]
        node_name = config["node_name"]
        hub_url = config["hub_url"].rstrip("/")
        token = config["agent_token"]
        poll_interval = int(config.get("poll_interval_seconds", 10))
        players = config.get("players", [])
        node_config_mirror = _build_node_config_mirror(config)

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

        for player in players:
            try:
                poll_player(node_id, hub_url, token, player, node_config_mirror=node_config_mirror)
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
        if command == "--open-local-ui":
            return open_local_ui_command()
        if command == "--uninstall-service":
            return uninstall_service_command()
        if command == "--service-loop":
            return run_agent_loop()

    if _is_interactive_session():
        return interactive_entrypoint()

    return run_agent_loop()


if __name__ == "__main__":
    sys.exit(main())
