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
import re
import logging
import shutil
import socket
import subprocess
import tempfile
import threading
import traceback
import webbrowser
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import yaml
import requests
import psutil

from confidence_scorer import score_detection_payload
from monitors import process_monitor, log_monitor, file_monitor, connectivity, udp_probe
from playout_profiles import (
    DEFAULT_PLAYOUT_TYPE,
    get_playout_profile,
    normalize_playout_type,
    playout_family,
    playout_profiles_for_ui,
)

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
    "executable_path_contains",
    "executable_path_regex",
    "command_line_contains",
    "command_line_regex",
    "window_title",
    "window_title_contains",
    "window_title_regex",
    "window_title_regexes",
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
WINDOWS_UNINSTALL_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ClarixPulse"
DEFAULT_HUB_URL = "https://pulse.clarixtech.com"
LOCAL_UI_HOST = "127.0.0.1"
LOCAL_UI_PORT = 3210
TEMP_LOCAL_UI_PORT_START = 3211
TEMP_LOCAL_UI_PORT_END = 3299
DEFAULT_POLL_INTERVAL_SECONDS = 3
HEARTBEAT_POST_TIMEOUT_SECONDS = 5
HEARTBEAT_RETRY_DELAYS_SECONDS = (1.0, 2.0)
RETRYABLE_HTTP_STATUS_CODES = {408, 429, 500, 502, 503, 504}
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
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      background: #08111d;
      color: var(--text);
      font-size: 14px;
    }
    textarea {
      min-height: 92px;
      resize: vertical;
      font-family: inherit;
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
    .button-like {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 10px 16px;
      background: #10243c;
      color: var(--text);
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      text-transform: none;
      letter-spacing: normal;
    }
    .button-like.primary {
      background: rgba(20,184,166,0.16);
      border-color: rgba(20,184,166,0.5);
    }
    .button-like input {
      display: none;
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
      <p>
        Fixed local access stays at http://127.0.0.1:3210/ after install, so operators can always reach setup on the node itself.
      </p>
    </section>

    <section class="panel">
      <h2 class="section-title">Node</h2>
      <div class="grid">
        <label>Node ID<input id="node_id"></label>
        <label>Node Name<input id="node_name"></label>
        <label>Site ID<input id="site_id"></label>
        <label>Hub URL<input id="hub_url"></label>
        <label>Agent Token (Auto)<input id="agent_token" placeholder="Auto-filled from provisioned setup"></label>
        <label>Legacy Enrollment Key (Optional)<input id="enrollment_key" placeholder="Only for legacy enrollment flow"></label>
        <label>Poll Interval (Seconds)<input id="poll_interval_seconds" type="number" min="1" max="120"></label>
      </div>
      <div class="row" style="margin-top:14px;">
        <div class="status-note" style="flex:1;">
          Sensitive identity and registration settings lock automatically after enrollment. Unlock them only when you intentionally want to move, rename, or re-register this node.
        </div>
        <label class="checkbox">
          <input id="unlock_sensitive_fields" type="checkbox">
          Unlock sensitive settings
        </label>
      </div>
    </section>

    <section class="panel">
      <div class="row">
        <div>
          <h2 class="section-title">Import Setup</h2>
          <p class="meta">Upload a discovery report, import a provisioned <code>config.yaml</code>, or pull one from a secure Clarix link or another direct HTTPS file URL.</p>
        </div>
        <label class="button-like primary">
          <input id="import_setup_file" type="file" accept=".json,.yaml,.yml,.txt,.conf">
          Upload report or config
        </label>
      </div>
      <div class="grid">
        <label>Pull Setup From URL
          <input id="import_setup_url" placeholder="https://pulse.clarixtech.com/api/downloads/nodes/example/config.yaml?token=SIGNED_LINK">
        </label>
      </div>
      <div class="row" style="margin-top:14px;">
        <button type="button" class="primary" onclick="PulseUi.importUrl()">Pull from link</button>
      </div>
        <div class="status-note">
        Pulse can fill node ID, site ID, hub URL, player paths, selectors, streams, and any existing auth values it finds in a scanned Pulse config. The discovery report can also suggest generic non-native players from running playout processes and log folders. For hub-hosted pulls, use the secure config link generated by the signed-in dashboard.
        </div>
    </section>

    <section class="panel">
      <div class="row">
        <h2 class="section-title">Players</h2>
        <button type="button" class="primary" id="add_player_button" onclick="PulseUi.addPlayer()">+ Add player</button>
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
    const PLAYOUT_PROFILES = __PLAYOUT_PROFILES__;
    const PLAYOUT_PROFILE_MAP = Object.fromEntries(PLAYOUT_PROFILES.map((profile) => [profile.id, profile]));
    const MAX_PLAYERS = 10;
    const MAX_UDP = 5;
    const DEFAULTS = {
      instaLogDir: "C:\\Program Files\\Indytek\\Insta log",
      instaRoot: "C:\\Program Files\\Indytek\\Insta Playout\\Settings",
      hubUrl: "https://pulse.clarixtech.com"
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

    function profileFor(playoutType) {
      return PLAYOUT_PROFILE_MAP[playoutType] || PLAYOUT_PROFILE_MAP.generic_windows;
    }

    function defaultPaths(playoutType, existingPaths = {}) {
      const profile = profileFor(playoutType);
      const uiMode = profile.ui_mode || "generic";
      if (uiMode === "admax") {
        return {
          admax_root_candidates: [
            (existingPaths.admax_root_candidates && existingPaths.admax_root_candidates[0]) || existingPaths.admax_root || ""
          ],
          fnf_log: existingPaths.fnf_log || "",
          playlistscan_log: existingPaths.playlistscan_log || ""
        };
      }
      if (uiMode === "insta") {
        return {
          shared_log_dir: existingPaths.shared_log_dir || DEFAULTS.instaLogDir,
          instance_root: existingPaths.instance_root || DEFAULTS.instaRoot,
          fnf_log: existingPaths.fnf_log || "",
          playlistscan_log: existingPaths.playlistscan_log || ""
        };
      }
      return {
        log_path: existingPaths.log_path || existingPaths.log_file || existingPaths.activity_log || "",
        fnf_log: existingPaths.fnf_log || "",
        playlistscan_log: existingPaths.playlistscan_log || ""
      };
    }

    function defaultPlayer(index) {
      const playoutType = "generic_windows";
      const playerId = `${state.node_id || "node"}-${playoutType}-${index + 1}`;
      return {
        player_id: playerId,
        playout_type: playoutType,
        paths: defaultPaths(playoutType),
        process_selectors: {},
        log_selectors: {},
        udp_inputs: [],
        advanced_open: false
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

    function identityLocked() {
      return !!state.identity_locked && !state.unlock_sensitive_fields;
    }

    function lockedPlayerIds() {
      return new Set(Array.isArray(state.locked_player_ids) ? state.locked_player_ids : []);
    }

    function playerIdentityLocked(player) {
      if (!identityLocked()) return false;
      return lockedPlayerIds().has(player.player_id || "");
    }

    function renderTop() {
      const lock = identityLocked();
      document.getElementById("node_id").value = state.node_id || "";
      document.getElementById("node_name").value = state.node_name || "";
      document.getElementById("site_id").value = state.site_id || "";
      document.getElementById("hub_url").value = state.hub_url || DEFAULTS.hubUrl;
      document.getElementById("agent_token").value = state.agent_token || "";
      document.getElementById("enrollment_key").value = state.enrollment_key || "";
      document.getElementById("poll_interval_seconds").value = state.poll_interval_seconds || 3;
      document.getElementById("import_setup_url").value = state.import_setup_url || "";
      document.getElementById("unlock_sensitive_fields").checked = !!state.unlock_sensitive_fields;
      document.getElementById("node_id").readOnly = lock;
      document.getElementById("hub_url").readOnly = lock;
      document.getElementById("agent_token").readOnly = lock;
      document.getElementById("enrollment_key").readOnly = lock;
      document.getElementById("add_player_button").disabled = lock;
    }

    function listText(value) {
      if (Array.isArray(value)) {
        return value.join("\n");
      }
      if (typeof value === "string") {
        return value;
      }
      return "";
    }

    function parseLines(value) {
      return String(value || "")
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    function isLikelyEnrollmentKey(value) {
      const text = String(value || "").trim();
      if (!text) return false;
      if (
        text.includes("://")
        || text.includes("/")
        || text.includes("?")
        || text.includes("&")
        || text.includes("=")
        || text.includes(" ")
      ) {
        return false;
      }
      return text.length >= 12;
    }

    function enrollmentKeyFromSetupUrl(rawValue) {
      const text = String(rawValue || "").trim();
      if (!text) return "";

      try {
        const parsed = new URL(text, window.location.origin);
        const queryKey = (
          parsed.searchParams.get("enrollment_key")
          || parsed.searchParams.get("enrollmentKey")
          || parsed.searchParams.get("enroll")
          || parsed.searchParams.get("key")
          || ""
        ).trim();

        let hashKey = "";
        if (parsed.hash && parsed.hash.includes("=")) {
          const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ""));
          hashKey = (
            hashParams.get("enrollment_key")
            || hashParams.get("enrollmentKey")
            || hashParams.get("enroll")
            || hashParams.get("key")
            || ""
          ).trim();
        }

        const candidate = queryKey || hashKey;
        return isLikelyEnrollmentKey(candidate) ? candidate : "";
      } catch {
        return isLikelyEnrollmentKey(text) ? text : "";
      }
    }

    function maybePrefillEnrollmentKeyFromSetupUrl(rawValue) {
      if (String(state.enrollment_key || "").trim()) return;

      const candidate = enrollmentKeyFromSetupUrl(rawValue);
      if (!candidate) return;

      state.enrollment_key = candidate;
      renderTop();
      showMessage("notice", "Enrollment key auto-filled from the setup link.");
    }

    function ensureAdvanced(player) {
      player.process_selectors = player.process_selectors || {};
      player.log_selectors = player.log_selectors || {};
    }

    function playoutOptionsHtml(selectedType) {
      return PLAYOUT_PROFILES.map((profile) => `
        <option value="${escapeHtml(profile.id)}" ${profile.id === selectedType ? "selected" : ""}>${escapeHtml(profile.label)}</option>
      `).join("");
    }

    function renderPathFields(player, playerIndex, profile) {
      const paths = player.paths || {};
      const uiMode = profile.ui_mode || "generic";
      if (uiMode === "insta") {
        return `
          <div class="grid">
            <label>Shared Log Dir
              <input value="${escapeHtml(paths.shared_log_dir || DEFAULTS.instaLogDir)}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'shared_log_dir', this.value)">
            </label>
            <label>Instance Root
              <input value="${escapeHtml(paths.instance_root || DEFAULTS.instaRoot)}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'instance_root', this.value)">
            </label>
            <label>FNF Log
              <input value="${escapeHtml(paths.fnf_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'fnf_log', this.value)">
            </label>
            <label>Playlist Scan Log
              <input value="${escapeHtml(paths.playlistscan_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'playlistscan_log', this.value)">
            </label>
          </div>
        `;
      }
      if (uiMode === "admax") {
        return `
          <div class="grid">
            <label>Admax Root
              <input value="${escapeHtml((paths.admax_root_candidates && paths.admax_root_candidates[0]) || paths.admax_root || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'admax_root', this.value)">
            </label>
            <label>FNF Log
              <input value="${escapeHtml(paths.fnf_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'fnf_log', this.value)">
            </label>
            <label>Playlist Scan Log
              <input value="${escapeHtml(paths.playlistscan_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'playlistscan_log', this.value)">
            </label>
          </div>
        `;
      }
      return `
        <div class="grid">
          <label>Primary Log File / Folder
            <input value="${escapeHtml(paths.log_path || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'log_path', this.value)">
          </label>
          <label>Content Error Log
            <input value="${escapeHtml(paths.fnf_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'fnf_log', this.value)">
          </label>
          <label>Secondary / Scan Log
            <input value="${escapeHtml(paths.playlistscan_log || '')}" oninput="PulseUi.updatePlayerPath(${playerIndex}, 'playlistscan_log', this.value)">
          </label>
        </div>
      `;
    }

    function renderPlayers() {
      const container = document.getElementById("players");
      const players = Array.isArray(state.players) ? state.players : [];
      if (players.length === 0) {
        container.innerHTML = '<div class="muted-card">No players added yet. Upload a discovery report or use Add player to start this node.</div>';
        return;
      }

      container.innerHTML = players.map((player, playerIndex) => {
        const udpInputs = Array.isArray(player.udp_inputs) ? player.udp_inputs : [];
        const selectedType = player.playout_type || "insta";
        const profile = profileFor(selectedType);
        const pathHtml = renderPathFields(player, playerIndex, profile);
        const playerLocked = playerIdentityLocked(player);

        const processSelectors = player.process_selectors || {};
        const logSelectors = player.log_selectors || {};
        const advancedHtml = `
          <div class="stack" style="margin-top:16px;">
            <h3 class="section-title">Advanced Selectors</h3>
            <div class="grid">
              <label>Process Names
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'process_names', this.value)">${escapeHtml(listText(processSelectors.process_names))}</textarea>
              </label>
              <label>Executable Path Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'executable_path_contains', this.value)">${escapeHtml(listText(processSelectors.executable_path_contains))}</textarea>
              </label>
              <label>Command Line Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'command_line_contains', this.value)">${escapeHtml(listText(processSelectors.command_line_contains))}</textarea>
              </label>
              <label>Window Title Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'window_title_contains', this.value)">${escapeHtml(listText(processSelectors.window_title_contains))}</textarea>
              </label>
              <label>Process Regex
                <input value="${escapeHtml(processSelectors.process_name_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'process_name_regex', this.value)">
              </label>
              <label>Executable Path Regex
                <input value="${escapeHtml(processSelectors.executable_path_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'executable_path_regex', this.value)">
              </label>
              <label>Command Line Regex
                <input value="${escapeHtml(processSelectors.command_line_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'command_line_regex', this.value)">
              </label>
              <label>Window Title Regex
                <input value="${escapeHtml(processSelectors.window_title_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'window_title_regex', this.value)">
              </label>
              <label>Service Names
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'service_names', this.value)">${escapeHtml(listText(processSelectors.service_names))}</textarea>
              </label>
              <label>Service Display Name Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'service_display_name_contains', this.value)">${escapeHtml(listText(processSelectors.service_display_name_contains))}</textarea>
              </label>
              <label>Service Path Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'process_selectors', 'service_path_contains', this.value)">${escapeHtml(listText(processSelectors.service_path_contains))}</textarea>
              </label>
              <label>Service Name Regex
                <input value="${escapeHtml(processSelectors.service_name_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'service_name_regex', this.value)">
              </label>
              <label>Service Display Regex
                <input value="${escapeHtml(processSelectors.service_display_name_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'service_display_name_regex', this.value)">
              </label>
              <label>Service Path Regex
                <input value="${escapeHtml(processSelectors.service_path_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'process_selectors', 'service_path_regex', this.value)">
              </label>
              <label>Log Include Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'log_selectors', 'include_contains', this.value)">${escapeHtml(listText(logSelectors.include_contains))}</textarea>
              </label>
              <label>Log Exclude Contains
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'log_selectors', 'exclude_contains', this.value)">${escapeHtml(listText(logSelectors.exclude_contains))}</textarea>
              </label>
              <label>Paused Regex
                <input value="${escapeHtml(logSelectors.paused_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'log_selectors', 'paused_regex', this.value)">
              </label>
              <label>Played Regex
                <input value="${escapeHtml(logSelectors.played_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'log_selectors', 'played_regex', this.value)">
              </label>
              <label>Skipped Regex
                <input value="${escapeHtml(logSelectors.skipped_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'log_selectors', 'skipped_regex', this.value)">
              </label>
              <label>Exited Regex
                <input value="${escapeHtml(logSelectors.exited_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'log_selectors', 'exited_regex', this.value)">
              </label>
              <label>Reinit Regex
                <input value="${escapeHtml(logSelectors.reinit_regex || '')}" oninput="PulseUi.updateSelectorValue(${playerIndex}, 'log_selectors', 'reinit_regex', this.value)">
              </label>
              <label>Token Patterns
                <textarea oninput="PulseUi.updateSelectorList(${playerIndex}, 'log_selectors', 'token_patterns', this.value)">${escapeHtml(listText(logSelectors.token_patterns))}</textarea>
              </label>
            </div>
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
              <div class="row">
                <button type="button" class="${player.advanced_open ? 'primary' : 'toggle-off'}" onclick="PulseUi.toggleAdvanced(${playerIndex})">
                  ${player.advanced_open ? 'Hide advanced' : 'Advanced'}
                </button>
                <button type="button" class="danger" onclick="PulseUi.removePlayer(${playerIndex})">Remove player</button>
              </div>
            </div>
            <div class="grid" style="margin-top:12px;">
              <label>Player ID
                <input value="${escapeHtml(player.player_id || '')}" ${playerLocked ? 'readonly' : ''} oninput="PulseUi.updatePlayer(${playerIndex}, 'player_id', this.value)">
              </label>
              <label>Playout Type
                <select onchange="PulseUi.updatePlayer(${playerIndex}, 'playout_type', this.value)">
                  ${playoutOptionsHtml(selectedType)}
                </select>
              </label>
            </div>
            <div class="status-note">${escapeHtml(profile.description || "")}</div>
            <div style="margin-top:14px;">${pathHtml}</div>
            ${player.advanced_open ? advancedHtml : ''}
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
      ["node_id", "node_name", "site_id", "hub_url", "agent_token", "enrollment_key", "poll_interval_seconds"].forEach((field) => {
        document.getElementById(field).addEventListener("input", (event) => {
          state[field] = event.target.value;
        });
      });
      document.getElementById("import_setup_url").addEventListener("input", (event) => {
        state.import_setup_url = event.target.value;
        maybePrefillEnrollmentKeyFromSetupUrl(state.import_setup_url);
      });
      document.getElementById("import_setup_file").addEventListener("change", (event) => {
        void window.PulseUi.importFile(event);
      });
      document.getElementById("unlock_sensitive_fields").addEventListener("change", (event) => {
        state.unlock_sensitive_fields = !!event.target.checked;
        render();
      });
    }

    window.PulseUi = {
      updatePlayer(index, key, value) {
        if (key === "player_id" && playerIdentityLocked(state.players[index])) {
          return;
        }
        state.players[index][key] = value;
        if (key === "playout_type") {
          state.players[index].paths = defaultPaths(value, state.players[index].paths || {});
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
      updateSelectorValue(playerIndex, group, key, value) {
        const player = state.players[playerIndex];
        ensureAdvanced(player);
        const cleaned = String(value || "").trim();
        if (cleaned) {
          player[group][key] = cleaned;
        } else {
          delete player[group][key];
        }
      },
      updateSelectorList(playerIndex, group, key, value) {
        const player = state.players[playerIndex];
        ensureAdvanced(player);
        const values = parseLines(value);
        if (values.length > 0) {
          player[group][key] = values;
        } else {
          delete player[group][key];
        }
      },
      toggleAdvanced(playerIndex) {
        const player = state.players[playerIndex];
        player.advanced_open = !player.advanced_open;
        renderPlayers();
      },
      addPlayer() {
        if (identityLocked()) {
          showMessage("error", "Unlock sensitive settings to add another player.");
          return;
        }
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
        const normalizedValue = key === "thumbnail_interval_s" ? Number(value) : value;
        udp[key] = normalizedValue;
        if (key === "stream_url") {
          const hasStream = String(normalizedValue || "").trim().length > 0;
          if (hasStream && !udp.enabled) {
            udp.enabled = true;
            renderPlayers();
          }
        }
      },
      async importFile(event) {
        showMessage("", "");
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        try {
          const documentText = await file.text();
          const response = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentText,
              currentState: state
            })
          });
          const payload = await response.json();
          if (!response.ok) {
            showMessage("error", payload.error || "Unable to import this file.");
            return;
          }
          state = payload.config;
          render();
          showMessage("notice", payload.message || `Imported ${file.name}. Save Local Settings to write it to config.yaml.`);
        } catch (error) {
          showMessage("error", error && error.message ? error.message : "Unable to import this file.");
        } finally {
          event.target.value = "";
        }
      },
      async importUrl() {
        showMessage("", "");
        const setupUrl = String(state.import_setup_url || "").trim();
        if (!setupUrl) {
          showMessage("error", "Paste a setup URL first.");
          return;
        }

        try {
          const response = await fetch("/api/import-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              setupUrl,
              currentState: state
            })
          });
          const payload = await response.json();
          if (!response.ok) {
            showMessage("error", payload.error || "Unable to pull setup from that URL.");
            return;
          }
          state = payload.config;
          state.import_setup_url = setupUrl;
          render();
          showMessage("notice", payload.message || "Setup pulled from link. Save Local Settings to write it to config.yaml.");
        } catch (error) {
          showMessage("error", error && error.message ? error.message : "Unable to pull setup from that URL.");
        }
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
        showMessage("notice", payload.message || "Local settings saved.");
      },
      async reload() {
        showMessage("", "");
        const response = await fetch("/api/config");
        const payload = await response.json();
        state = payload;
        render();
      }
    };

    maybePrefillEnrollmentKeyFromSetupUrl(window.location.href);
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


def _as_non_placeholder_str(value: Any, default: str = "") -> str:
    text = _as_str(value, default)
    if not text:
        return ""
    normalized = text.strip().lower()
    if "replace_me" in normalized:
        return ""
    if "replace_with_hub_enrollment_key" in normalized:
        return ""
    if "replace_with_hub_bootstrap_claim" in normalized:
        return ""
    if normalized.startswith("http://example") or normalized.startswith("https://example"):
        return ""
    return text


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


def _coerce_uploaded_player(player: Any) -> dict[str, Any] | None:
    if not isinstance(player, dict):
        return None

    normalized = dict(player)
    normalized.setdefault("player_id", player.get("playerId"))
    normalized.setdefault("playout_type", player.get("playoutType"))
    normalized.setdefault("process_selectors", player.get("processSelectors"))
    normalized.setdefault("log_selectors", player.get("logSelectors"))
    normalized.setdefault("udp_inputs", player.get("udpInputs"))

    if not isinstance(normalized.get("paths"), dict):
        lifted_paths = {
            key: player[key]
            for key in (
                "shared_log_dir",
                "instance_root",
                "fnf_log",
                "playlistscan_log",
                "log_path",
                "activity_log",
                "log_file",
                "admax_root",
                "admax_root_candidates",
                "playout_log_dir",
                "admax_state_path",
                "settings_ini",
            )
            if key in player
        }
        if lifted_paths:
            normalized["paths"] = lifted_paths

    return normalized


def _import_local_ui_state(document_text: str, current_state: Any = None) -> tuple[dict[str, Any], str]:
    raw_text = _as_str(document_text)
    if not raw_text:
        raise ValueError("Upload a JSON or YAML discovery report or config file first.")

    try:
        document = yaml.safe_load(raw_text) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Unable to parse uploaded file: {exc}") from exc

    if not isinstance(document, dict):
        raise ValueError("Uploaded file must contain a top-level mapping.")

    current = current_state if isinstance(current_state, dict) else {}
    discovery = _as_mapping(document.get("discovery"))
    existing_pulse_config = _as_mapping(discovery.get("existing_pulse_config"))
    current_agent_token = _as_non_placeholder_str(current.get("agent_token"))
    current_bootstrap_claim = _as_non_placeholder_str(current.get("bootstrap_claim"))
    uploaded_agent_token = _as_non_placeholder_str(
        document.get("agent_token")
        or document.get("agentToken")
        or existing_pulse_config.get("agent_token")
    )
    uploaded_bootstrap_claim = _as_non_placeholder_str(
        document.get("bootstrap_claim")
        or document.get("bootstrapClaim")
        or existing_pulse_config.get("bootstrap_claim")
        or existing_pulse_config.get("bootstrapClaim")
    )
    uploaded_bootstrap_claim_expires_at = _as_str(
        document.get("bootstrap_claim_expires_at")
        or document.get("bootstrapClaimExpiresAt")
        or existing_pulse_config.get("bootstrap_claim_expires_at")
        or existing_pulse_config.get("bootstrapClaimExpiresAt")
    )
    agent_token = uploaded_agent_token or current_agent_token
    bootstrap_claim = uploaded_bootstrap_claim or current_bootstrap_claim
    bootstrap_claim_expires_at = uploaded_bootstrap_claim_expires_at or _as_str(current.get("bootstrap_claim_expires_at"))

    node_id = _as_str(
        document.get("node_id")
        or document.get("nodeId")
        or document.get("agent_id")
        or existing_pulse_config.get("node_id"),
        _as_str(current.get("node_id"), socket.gethostname().lower().replace(" ", "-")),
    )
    node_name = _as_str(
        document.get("node_name")
        or document.get("nodeName")
        or document.get("pc_name")
        or existing_pulse_config.get("node_name"),
        _as_str(current.get("node_name"), socket.gethostname()),
    )
    site_id = _as_str(
        document.get("site_id") or document.get("siteId") or existing_pulse_config.get("site_id"),
        _as_str(current.get("site_id"), _default_site_id(node_id)),
    )
    hub_url = _as_str(
        document.get("hub_url") or document.get("hubUrl") or existing_pulse_config.get("hub_url"),
        _as_str(current.get("hub_url"), DEFAULT_HUB_URL),
    )
    poll_interval_seconds = max(
        1,
        min(
            120,
            _as_int(
                document.get("poll_interval_seconds", document.get("pollIntervalSeconds")),
                _as_int(current.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS),
            ),
        ),
    )
    enrollment_key = _as_non_placeholder_str(
        document.get("enrollment_key")
        or document.get("enrollmentKey")
        or existing_pulse_config.get("enrollment_key"),
        _as_non_placeholder_str(current.get("enrollment_key")),
    )

    players_key_present = "players" in document or "instances" in document
    players_raw = document.get("players")
    if not isinstance(players_raw, list):
        players_raw = document.get("instances")
    if not isinstance(players_raw, list):
        players_raw = []

    if not players_key_present and isinstance(current.get("players"), list):
        players_raw = current.get("players", [])

    if len(players_raw) > 10:
        raise ValueError("Uploaded file defines more than 10 players. Split it into smaller nodes before importing.")

    players = [
        _build_default_player_for_ui(index, node_id, normalized_player)
        for index, raw_player in enumerate(players_raw)
        for normalized_player in [_coerce_uploaded_player(raw_player)]
        if normalized_player is not None
    ]

    locked_player_ids = [
        _as_str(player.get("player_id"))
        for player in players
        if _as_str(player.get("player_id"))
    ] if (agent_token or bootstrap_claim) else []

    if (current_agent_token or current_bootstrap_claim) and not (uploaded_agent_token or uploaded_bootstrap_claim) and isinstance(current.get("locked_player_ids"), list):
        current_locked_ids = [_as_str(value) for value in current.get("locked_player_ids", []) if _as_str(value)]
        if current_locked_ids:
            locked_player_ids = current_locked_ids

    imported_state = {
        "node_id": node_id,
        "node_name": node_name,
        "site_id": site_id,
        "hub_url": hub_url,
        "agent_token": agent_token,
        "bootstrap_claim": bootstrap_claim,
        "bootstrap_claim_expires_at": bootstrap_claim_expires_at,
        "enrollment_key": enrollment_key,
        "identity_locked": bool(agent_token or bootstrap_claim),
        "unlock_sensitive_fields": False,
        "imported_sensitive_override": bool(uploaded_agent_token or uploaded_bootstrap_claim),
        "locked_player_ids": locked_player_ids,
        "poll_interval_seconds": poll_interval_seconds,
        "players": players,
    }

    if uploaded_agent_token or uploaded_bootstrap_claim:
        if current_agent_token and uploaded_agent_token and current_agent_token != uploaded_agent_token:
            return (
                imported_state,
                "Provisioned config imported. Save Local Settings to replace the current local registration with this provisioned node config.",
            )
        return (
            imported_state,
            "Provisioned config imported. Save Local Settings to complete node registration without manual token entry.",
        )

    return (
        imported_state,
        "Discovery report imported. Review the hub URL if needed, then save local settings.",
    )


def _pull_remote_setup_url(setup_url: Any, current_state: Any = None) -> tuple[dict[str, Any], str]:
    url = _as_str(setup_url)
    if not url:
        raise ValueError("Setup URL is required.")
    if not (url.lower().startswith("https://") or url.lower().startswith("http://")):
        raise ValueError("Setup URL must start with http:// or https://")

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"Failed to pull setup from {url}: {exc}") from exc

    imported_state, message = _import_local_ui_state(response.text, current_state)
    return imported_state, f"{message} Pulled from {url}."


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
    family = playout_family(playout_type)

    instance_root = _as_str(paths.get("instance_root"))
    if not instance_root:
        legacy_player_root = _as_str(paths.get("player_root"))
        if legacy_player_root:
            paths["instance_root"] = legacy_player_root

    admax_root = _as_str(paths.get("admax_root"))
    if family == "admax" and not admax_root:
        log_dir = _as_str(paths.get("log_dir")).rstrip("\\/")
        if log_dir:
            derived_root = log_dir
            for _ in range(3):
                derived_root = os.path.dirname(derived_root)
            if derived_root:
                paths["admax_root"] = derived_root

    if family == "generic":
        log_path = _as_str(
            paths.get("log_path")
            or paths.get("activity_log")
            or paths.get("log_file")
            or paths.get("shared_log_dir")
            or paths.get("log_dir")
        )
        if log_path:
            paths["log_path"] = log_path

    if family == "admax":
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


PROCESS_SELECTOR_LIST_UI_KEYS = {
    "process_names",
    "process_name_regexes",
    "executable_path_contains",
    "command_line_contains",
    "window_title_contains",
    "window_title_regexes",
    "service_names",
    "service_name_regexes",
    "service_display_name_contains",
    "service_display_name_regexes",
    "service_path_contains",
}

PROCESS_SELECTOR_STRING_UI_KEYS = {
    "process_name",
    "process_name_regex",
    "executable_path_regex",
    "command_line_regex",
    "window_title",
    "window_title_regex",
    "service_name",
    "service_name_regex",
    "service_display_name",
    "service_display_name_regex",
    "service_path_regex",
}

LOG_SELECTOR_LIST_UI_KEYS = {
    "include_contains",
    "exclude_contains",
    "include_regexes",
    "exclude_regexes",
    "token_patterns",
}

LOG_SELECTOR_STRING_UI_KEYS = {
    "paused_regex",
    "played_regex",
    "skipped_regex",
    "exited_regex",
    "reinit_regex",
}


def _normalize_ui_selector_list(value: Any) -> list[str]:
    if isinstance(value, str):
        parts = []
        for chunk in value.replace("\r", "\n").split("\n"):
            parts.extend(chunk.split(","))
        return _dedupe_strings(parts)
    if isinstance(value, (list, tuple, set)):
        return _dedupe_strings([_as_str(item) for item in value])
    return []


def _merge_local_ui_selectors(
    existing_selectors: dict[str, Any],
    raw_selectors: Any,
    list_keys: set[str],
    string_keys: set[str],
) -> dict[str, Any]:
    merged = dict(existing_selectors)
    if not isinstance(raw_selectors, dict):
        return merged

    for key in list_keys:
        if key not in raw_selectors:
            continue
        values = _normalize_ui_selector_list(raw_selectors.get(key))
        if values:
            merged[key] = values
        else:
            merged.pop(key, None)

    for key in string_keys:
        if key not in raw_selectors:
            continue
        text = _as_str(raw_selectors.get(key))
        if text:
            merged[key] = text
        else:
            merged.pop(key, None)

    return merged


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

    playout_type = normalize_playout_type(player.get("playout_type") or player.get("software") or DEFAULT_PLAYOUT_TYPE)
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
    agent_token = _as_non_placeholder_str(raw.get("agent_token"))
    bootstrap_claim = _as_non_placeholder_str(raw.get("bootstrap_claim") or raw.get("bootstrapClaim"))
    bootstrap_claim_expires_at = _as_str(raw.get("bootstrap_claim_expires_at") or raw.get("bootstrapClaimExpiresAt"))
    enrollment_key = _as_non_placeholder_str(raw.get("enrollment_key"))
    poll_interval_seconds = max(1, _as_int(raw.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS))

    if not hub_url:
        raise ValueError("config.yaml missing hub_url")

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
        "bootstrap_claim": bootstrap_claim,
        "bootstrap_claim_expires_at": bootstrap_claim_expires_at,
        "enrollment_key": enrollment_key,
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
    if os.name != "nt":
        print("ERROR: Administrator privileges are required on Windows.")
        return 1

    executable = sys.executable
    child_args = list(args)
    if not getattr(sys, "frozen", False):
        child_args = [os.path.abspath(__file__), *child_args]

    try:
        import base64

        script = "\n".join(
            [
                "$ErrorActionPreference = 'Stop'",
                f"$exe = {json.dumps(executable)}",
                f"$argList = @({', '.join(json.dumps(arg) for arg in child_args)})",
                "$process = Start-Process -FilePath $exe -ArgumentList $argList -Verb RunAs -Wait -PassThru",
                "exit $process.ExitCode",
            ]
        )
        encoded_script = base64.b64encode(script.encode("utf-16le")).decode("ascii")
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded_script],
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.strip()
            stdout = completed.stdout.strip()
            details = stderr or stdout or f"exit code {completed.returncode}"
            print(f"ERROR: Unable to request Administrator privileges. {details}")
        return completed.returncode
    except Exception as exc:
        print(f"ERROR: Unable to request Administrator privileges. {exc}")
        return 1


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


def _write_config_like_file(path: str, data: dict[str, Any]) -> None:
    if path.lower().endswith(".json"):
        _ensure_directory(os.path.dirname(path))
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.write("\n")
        return
    _write_yaml(path, data)


def _strip_local_enrollment_credentials(raw: dict[str, Any] | None) -> dict[str, Any]:
    cleaned = copy.deepcopy(raw) if isinstance(raw, dict) else {}
    for key in (
        "agent_token",
        "enrollment_key",
        "bootstrap_claim",
        "bootstrap_claim_expires_at",
        "agentToken",
        "enrollmentKey",
        "bootstrapClaim",
        "bootstrapClaimExpiresAt",
    ):
        cleaned.pop(key, None)
    return cleaned


def _detect_bundle_version() -> str:
    base_name = os.path.basename(_base_dir()).strip()
    if base_name.lower().startswith("clarix-pulse-"):
        return base_name[len("clarix-pulse-") :]

    parent_name = os.path.basename(os.path.dirname(_base_dir())).strip()
    if parent_name.lower().startswith("clarix-pulse-"):
        return parent_name[len("clarix-pulse-") :]

    return ""


def _windows_uninstall_registry_values(install_dir: str) -> dict[str, Any]:
    uninstall_exe = os.path.abspath(os.path.join(install_dir, "clarix-agent.exe"))
    uninstall_bat = os.path.abspath(os.path.join(install_dir, "uninstall.bat"))
    comspec = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "cmd.exe")
    uninstall_string = subprocess.list2cmdline([comspec, "/c", uninstall_bat])
    values: dict[str, Any] = {
        "DisplayName": "Clarix Pulse",
        "Publisher": "Clarix Pulse",
        "InstallLocation": os.path.abspath(install_dir),
        "InstallSource": os.path.abspath(_base_dir()),
        "UninstallString": uninstall_string,
        "QuietUninstallString": uninstall_string,
        "DisplayIcon": uninstall_exe,
        "NoModify": 1,
        "NoRepair": 1,
        "InstallDate": datetime.now().strftime("%Y%m%d"),
        "WindowsInstaller": 0,
    }
    version = _detect_bundle_version()
    if version:
        values["DisplayVersion"] = version
    return values


def _write_windows_uninstall_registration(install_dir: str) -> None:
    if os.name != "nt":
        return

    try:
        import winreg  # type: ignore
    except ImportError:
        return

    _delete_windows_registry_tree(winreg.HKEY_LOCAL_MACHINE, WINDOWS_UNINSTALL_REG_PATH)
    values = _windows_uninstall_registry_values(install_dir)
    try:
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, WINDOWS_UNINSTALL_REG_PATH, 0, winreg.KEY_WRITE) as key:
            for name, value in values.items():
                if isinstance(value, int):
                    winreg.SetValueEx(key, name, 0, winreg.REG_DWORD, value)
                else:
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, str(value))
    except OSError as exc:
        log.warning(f"Could not write Windows uninstall registration: {exc}")


def _delete_windows_registry_tree(root: Any, subkey: str) -> None:
    try:
        import winreg  # type: ignore
    except ImportError:
        return

    try:
        with winreg.OpenKey(root, subkey, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
            child_keys: list[str] = []
            index = 0
            while True:
                try:
                    child_keys.append(winreg.EnumKey(key, index))
                    index += 1
                except OSError:
                    break

            for child_key in child_keys:
                _delete_windows_registry_tree(root, f"{subkey}\\{child_key}")

            value_names: list[str] = []
            index = 0
            while True:
                try:
                    value_names.append(winreg.EnumValue(key, index)[0])
                    index += 1
                except OSError:
                    break

            for value_name in value_names:
                try:
                    winreg.DeleteValue(key, value_name)
                except FileNotFoundError:
                    continue
                except OSError as exc:
                    log.warning(f"Could not remove uninstall registration value '{value_name}': {exc}")
    except FileNotFoundError:
        return
    except OSError as exc:
        log.warning(f"Could not open uninstall registration key '{subkey}': {exc}")
        return

    try:
        winreg.DeleteKey(root, subkey)
    except FileNotFoundError:
        return
    except OSError as exc:
        log.warning(f"Could not remove uninstall registration key '{subkey}': {exc}")


def _remove_windows_uninstall_registration() -> None:
    if os.name != "nt":
        return

    try:
        import winreg  # type: ignore
    except ImportError:
        return

    _delete_windows_registry_tree(winreg.HKEY_LOCAL_MACHINE, WINDOWS_UNINSTALL_REG_PATH)


def _sanitize_local_enrollment_credentials() -> None:
    candidate_paths = [
        _runtime_config_path(),
        _installed_path("config.yaml"),
        _installed_path("pulse-account.json"),
        _bundle_path("config.yaml"),
        _bundle_path("pulse-account.json"),
    ]

    seen: set[str] = set()
    for path in candidate_paths:
        normalized = os.path.abspath(path)
        if normalized in seen or not os.path.exists(normalized):
            continue
        seen.add(normalized)

        try:
            existing = _load_yaml_if_exists(normalized)
            if not isinstance(existing, dict):
                continue

            sanitized = _strip_local_enrollment_credentials(existing)
            if sanitized != existing:
                _write_config_like_file(normalized, sanitized)
                log.info(f"Removed local enrollment credentials from {normalized}")
        except Exception as exc:
            log.warning(f"Could not sanitize local enrollment credentials in {normalized}: {exc}")


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

    current_pid = os.getpid()
    for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid == current_pid:
                continue
            name = str(proc.info.get("name") or "").lower()
            exe_path = str(proc.info.get("exe") or "").lower()
            cmdline = " ".join(str(part) for part in (proc.info.get("cmdline") or [])).lower()
            haystack = " ".join(part for part in (name, exe_path, cmdline) if part)
            if "clarix-agent" not in haystack and "clarixpulse" not in haystack:
                continue
            proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError, ValueError):
            continue

    time.sleep(2)


def _remove_path_best_effort(path: str) -> bool:
    normalized = os.path.abspath(path)
    if not path or not os.path.exists(normalized):
        return False

    for attempt in range(1, 7):
        try:
            if os.path.isdir(normalized) and not os.path.islink(normalized):
                shutil.rmtree(normalized)
            else:
                os.remove(normalized)
        except FileNotFoundError:
            log.info(f"Removed Pulse artifact: {normalized}")
            return True
        except Exception as exc:
            if attempt < 6:
                time.sleep(0.35)
                continue
            log.warning(f"Could not remove Pulse artifact '{normalized}': {exc}")
            return False

        if not os.path.exists(normalized):
            log.info(f"Removed Pulse artifact: {normalized}")
            return True

        if attempt < 6:
            time.sleep(0.35)

    log.warning(f"Could not remove Pulse artifact '{normalized}': path is still present.")
    return False


def _remove_windows_autorun_entries() -> None:
    try:
        import winreg  # type: ignore
    except ImportError:
        return

    targets = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\RunOnce"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\RunServices"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\RunServicesOnce"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\RunOnce"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\RunServices"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\RunServicesOnce"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32"),
    ]

    for root, subkey in targets:
        try:
            with winreg.OpenKey(root, subkey, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
                value_count = winreg.QueryInfoKey(key)[1]
                candidate_names: list[str] = []
                for index in range(value_count):
                    value_name, value_data, _ = winreg.EnumValue(key, index)
                    value_text = f"{value_name} {value_data}".lower()
                    if "clarix" in value_text or "pulse" in value_text or "clarix-agent" in value_text:
                        candidate_names.append(value_name)
                for value_name in candidate_names:
                    try:
                        winreg.DeleteValue(key, value_name)
                        log.info(f"Removed startup entry: {subkey}\\{value_name}")
                    except FileNotFoundError:
                        continue
                    except OSError as exc:
                        log.warning(f"Could not remove startup entry '{subkey}\\{value_name}': {exc}")
        except FileNotFoundError:
            continue
        except OSError as exc:
            log.debug(f"Could not inspect startup registry key '{subkey}': {exc}")


def _remove_startup_folder_remnants() -> None:
    startup_roots = []
    app_data = os.environ.get("APPDATA")
    program_data = os.environ.get("PROGRAMDATA")
    if app_data:
        startup_roots.append(os.path.join(app_data, r"Microsoft\Windows\Start Menu\Programs\Startup"))
    if program_data:
        startup_roots.append(os.path.join(program_data, r"Microsoft\Windows\Start Menu\Programs\Startup"))

    for root in startup_roots:
        if not os.path.isdir(root):
            continue
        try:
            for entry in os.scandir(root):
                if any(token in entry.name.lower() for token in ("clarix", "pulse")):
                    _remove_path_best_effort(entry.path)
        except OSError as exc:
            log.debug(f"Could not inspect startup folder '{root}': {exc}")


def _cleanup_uninstall_artifacts() -> bool:
    install_root = os.path.abspath(os.path.join(INSTALL_DIR, os.pardir))
    candidate_paths = [
        INSTALL_DIR,
        install_root,
        r"C:\pulse-node-bundle",
        r"C:\Program Files\ClarixPulse",
        r"C:\Program Files (x86)\ClarixPulse",
    ]

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidate_paths.extend(
            [
                os.path.join(local_app_data, "ClarixPulse"),
                os.path.join(local_app_data, "ClarixPulse", "Bundles"),
            ]
        )

    temp_dir = tempfile.gettempdir()
    if temp_dir:
        candidate_paths.extend(
            [
                os.path.join(temp_dir, "ClarixPulse"),
                os.path.join(temp_dir, "ClarixPulse", "Bundles"),
            ]
        )

    base_dir = os.path.abspath(_base_dir())
    if base_dir and base_dir not in {os.path.abspath(INSTALL_DIR), os.path.abspath(os.environ.get("ProgramData", r"C:\ProgramData"))}:
        if any(token in os.path.basename(base_dir).lower() for token in ("clarix", "pulse")):
            candidate_paths.append(base_dir)

    cleanup_incomplete = False
    for path in candidate_paths:
        removed = _remove_path_best_effort(path)
        if not removed and os.path.exists(os.path.abspath(path)):
            cleanup_incomplete = True

    _remove_windows_autorun_entries()
    _remove_startup_folder_remnants()
    _remove_windows_uninstall_registration()
    return cleanup_incomplete


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


def _config_for_hub_sync(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    node_id = _as_str(raw.get("node_id") or raw.get("agent_id"))
    hub_url = _as_str(raw.get("hub_url"))
    agent_token = _as_non_placeholder_str(raw.get("agent_token"))
    if not node_id or not hub_url or not agent_token:
        return None

    players_raw = raw.get("players")
    if players_raw is None:
        players_raw = raw.get("instances", [])

    players: list[dict[str, Any]] = []
    if isinstance(players_raw, list):
        for index, player in enumerate(players_raw):
            normalized = _normalize_player(player, index)
            if normalized is not None:
                players.append(normalized)

    return {
        "node_id": node_id,
        "node_name": _as_str(raw.get("node_name") or raw.get("pc_name") or node_id),
        "site_id": _as_str(raw.get("site_id")),
        "hub_url": hub_url,
        "agent_token": agent_token,
        "poll_interval_seconds": max(1, _as_int(raw.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS)),
        "players": players,
    }


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
    profile = get_playout_profile(playout_type)
    ui_mode = str(profile.get("ui_mode") or "generic")

    if ui_mode == "admax":
        admax_root = _as_str(existing_paths.get("admax_root"))
        if not admax_root:
            candidates = existing_paths.get("admax_root_candidates")
            if isinstance(candidates, list) and candidates:
                admax_root = _as_str(candidates[0])
        return {
            "admax_root_candidates": [admax_root],
            "fnf_log": _as_str(existing_paths.get("fnf_log")),
            "playlistscan_log": _as_str(existing_paths.get("playlistscan_log")),
        }

    if ui_mode == "insta":
        return {
            "shared_log_dir": _as_str(existing_paths.get("shared_log_dir"), DEFAULT_INSTA_LOG_DIR),
            "instance_root": _as_str(existing_paths.get("instance_root"), DEFAULT_INSTA_INSTANCE_ROOT),
            "fnf_log": _as_str(existing_paths.get("fnf_log")),
            "playlistscan_log": _as_str(existing_paths.get("playlistscan_log")),
        }

    return {
        "log_path": _as_str(
            existing_paths.get("log_path")
            or existing_paths.get("activity_log")
            or existing_paths.get("log_file")
        ),
        "fnf_log": _as_str(existing_paths.get("fnf_log")),
        "playlistscan_log": _as_str(existing_paths.get("playlistscan_log")),
    }


def _build_default_player_for_ui(index: int, node_id: str, existing_player: dict[str, Any] | None = None) -> dict[str, Any]:
    existing_player = existing_player or {}
    playout_type = normalize_playout_type(existing_player.get("playout_type") or DEFAULT_PLAYOUT_TYPE)
    player_id = _as_str(existing_player.get("player_id"), _default_player_id(node_id, playout_type, index))
    existing_paths = _as_mapping(existing_player.get("paths"))

    udp_inputs = _sync_udp_inputs(player_id, existing_player.get("udp_inputs", []))

    return {
        "player_id": player_id,
        "playout_type": playout_type,
        "paths": _default_player_paths(playout_type, existing_paths),
        "process_selectors": _normalize_process_selectors(existing_player),
        "log_selectors": _normalize_log_selectors(existing_player),
        "udp_inputs": udp_inputs,
        "advanced_open": _as_bool(existing_player.get("advanced_open"), False),
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
    agent_token = _as_non_placeholder_str(existing.get("agent_token"))
    bootstrap_claim = _as_non_placeholder_str(existing.get("bootstrap_claim"))
    bootstrap_claim_expires_at = _as_str(existing.get("bootstrap_claim_expires_at"))
    enrollment_key = _as_non_placeholder_str(existing.get("enrollment_key"))

    return {
        "node_id": node_id,
        "node_name": _as_str(existing.get("node_name"), socket.gethostname()),
        "site_id": _as_str(existing.get("site_id"), _default_site_id(node_id)),
        "hub_url": _as_str(existing.get("hub_url"), DEFAULT_HUB_URL),
        "agent_token": agent_token,
        "bootstrap_claim": bootstrap_claim,
        "bootstrap_claim_expires_at": bootstrap_claim_expires_at,
        "enrollment_key": enrollment_key,
        "import_setup_url": "",
        "imported_sensitive_override": False,
        "identity_locked": bool(agent_token or bootstrap_claim),
        "unlock_sensitive_fields": False,
        "locked_player_ids": [
            _as_str(player.get("player_id"))
            for player in existing_players
            if isinstance(player, dict) and _as_str(player.get("player_id"))
        ],
        "poll_interval_seconds": max(1, _as_int(existing.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS)),
        "players": players,
    }


def _normalize_local_ui_submission(payload: Any, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Invalid local configuration payload.")

    existing = copy.deepcopy(existing or {})
    existing_agent_token = _as_non_placeholder_str(existing.get("agent_token"))
    existing_bootstrap_claim = _as_non_placeholder_str(existing.get("bootstrap_claim"))
    existing_bootstrap_claim_expires_at = _as_str(existing.get("bootstrap_claim_expires_at"))
    existing_enrollment_key = _as_non_placeholder_str(existing.get("enrollment_key"))
    existing_registered = bool(existing_agent_token or existing_bootstrap_claim)
    allow_sensitive_edits = (
        _as_bool(payload.get("imported_sensitive_override"), False)
        or (not existing_registered)
        or _as_bool(payload.get("unlock_sensitive_fields"), False)
    )

    submitted_node_id = _as_str(payload.get("node_id"), socket.gethostname().lower().replace(" ", "-"))
    existing_node_id = _as_str(existing.get("node_id"))
    node_id = submitted_node_id if allow_sensitive_edits or not existing_node_id else existing_node_id
    node_name = _as_str(payload.get("node_name"), socket.gethostname())
    site_id = _as_str(payload.get("site_id"), _default_site_id(node_id))
    submitted_hub_url = _as_str(payload.get("hub_url"), DEFAULT_HUB_URL)
    hub_url = submitted_hub_url if allow_sensitive_edits or not _as_str(existing.get("hub_url")) else _as_str(existing.get("hub_url"))
    submitted_agent_token = _as_non_placeholder_str(payload.get("agent_token"))
    agent_token = submitted_agent_token if allow_sensitive_edits or not existing_agent_token else existing_agent_token
    submitted_bootstrap_claim = _as_non_placeholder_str(payload.get("bootstrap_claim"))
    bootstrap_claim = (
        submitted_bootstrap_claim
        if allow_sensitive_edits
        else (existing_bootstrap_claim or submitted_bootstrap_claim)
    )
    submitted_bootstrap_claim_expires_at = _as_str(payload.get("bootstrap_claim_expires_at"))
    bootstrap_claim_expires_at = (
        submitted_bootstrap_claim_expires_at
        if allow_sensitive_edits
        else (existing_bootstrap_claim_expires_at or submitted_bootstrap_claim_expires_at)
    )
    submitted_enrollment_key = _as_non_placeholder_str(payload.get("enrollment_key"))
    enrollment_key = (
        submitted_enrollment_key
        if allow_sensitive_edits
        else (existing_enrollment_key or submitted_enrollment_key)
    )
    if agent_token:
        bootstrap_claim = ""
        bootstrap_claim_expires_at = ""
    poll_interval_seconds = max(1, min(120, _as_int(payload.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS)))

    if not node_id:
        raise ValueError("Node ID is required.")
    if not node_name:
        raise ValueError("Node name is required.")
    if not site_id:
        raise ValueError("Site ID is required.")
    if not hub_url:
        raise ValueError("Hub URL is required.")

    players_raw = payload.get("players")
    if not isinstance(players_raw, list) or not players_raw:
        raise ValueError("Add at least one player.")
    if len(players_raw) > 10:
        raise ValueError("Pulse supports up to 10 players per node.")

    existing_players = existing.get("players") if isinstance(existing.get("players"), list) else []
    existing_players_by_id = {
        _as_str(player.get("player_id")): player
        for player in existing_players
        if isinstance(player, dict) and _as_str(player.get("player_id"))
    }
    if existing_registered and not allow_sensitive_edits:
        submitted_existing_ids = [
            _as_str(raw_player.get("player_id"))
            for raw_player in players_raw
            if isinstance(raw_player, dict) and _as_str(raw_player.get("player_id"))
        ]
        unexpected_player_ids = [
            player_id
            for player_id in submitted_existing_ids
            if player_id not in existing_players_by_id
        ]
        if unexpected_player_ids:
            raise ValueError("Unlock sensitive settings to add a new player or change player IDs.")

    merged_players: list[dict[str, Any]] = []

    for index, raw_player in enumerate(players_raw):
        if not isinstance(raw_player, dict):
            continue

        playout_type = normalize_playout_type(raw_player.get("playout_type") or DEFAULT_PLAYOUT_TYPE)
        profile = get_playout_profile(playout_type)
        ui_mode = str(profile.get("ui_mode") or "generic")

        indexed_existing_player = (
            existing_players[index]
            if index < len(existing_players) and isinstance(existing_players[index], dict)
            else {}
        )
        locked_existing_player_id = _as_str(indexed_existing_player.get("player_id"))
        submitted_player_id = _as_str(raw_player.get("player_id"), _default_player_id(node_id, playout_type, index))
        if existing_registered and not allow_sensitive_edits:
            existing_player = existing_players_by_id.get(submitted_player_id, indexed_existing_player)
            player_id = _as_str(existing_player.get("player_id"), submitted_player_id)
        else:
            player_id = submitted_player_id
        if not player_id:
            raise ValueError(f"Player {index + 1} needs an ID.")

        existing_player = indexed_existing_player
        if existing_registered and not allow_sensitive_edits:
            existing_player = existing_players_by_id.get(player_id, indexed_existing_player)
        elif allow_sensitive_edits or not locked_existing_player_id:
            existing_player = next(
                (
                    player for player in existing_players
                    if isinstance(player, dict) and _as_str(player.get("player_id")) == player_id
                ),
                indexed_existing_player,
            )
        merged_player = copy.deepcopy(existing_player) if isinstance(existing_player, dict) else {}
        merged_player["player_id"] = player_id
        merged_player["playout_type"] = playout_type

        raw_paths = _as_mapping(raw_player.get("paths"))
        if ui_mode == "admax":
            admax_root = _as_str(raw_paths.get("admax_root"))
            if not admax_root:
                candidates = raw_paths.get("admax_root_candidates")
                if isinstance(candidates, list) and candidates:
                    admax_root = _as_str(candidates[0])
            if not admax_root:
                raise ValueError(f"{player_id} needs an Admax root.")
            merged_player["paths"] = {
                "admax_root_candidates": [admax_root],
                "fnf_log": _as_str(raw_paths.get("fnf_log")),
                "playlistscan_log": _as_str(raw_paths.get("playlistscan_log")),
            }
        elif ui_mode == "insta":
            shared_log_dir = _as_str(raw_paths.get("shared_log_dir"), DEFAULT_INSTA_LOG_DIR)
            instance_root = _as_str(raw_paths.get("instance_root"), DEFAULT_INSTA_INSTANCE_ROOT)
            if not shared_log_dir or not instance_root:
                raise ValueError(f"{player_id} needs both Insta paths.")
            merged_player["paths"] = {
                "shared_log_dir": shared_log_dir,
                "instance_root": instance_root,
                "fnf_log": _as_str(raw_paths.get("fnf_log")),
                "playlistscan_log": _as_str(raw_paths.get("playlistscan_log")),
            }
        else:
            generic_paths = {
                "log_path": _as_str(
                    raw_paths.get("log_path")
                    or raw_paths.get("activity_log")
                    or raw_paths.get("log_file")
                ),
                "fnf_log": _as_str(raw_paths.get("fnf_log")),
                "playlistscan_log": _as_str(raw_paths.get("playlistscan_log")),
            }
            generic_paths = {key: value for key, value in generic_paths.items() if value}
            merged_player["paths"] = generic_paths

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
        merged_player["process_selectors"] = _merge_local_ui_selectors(
            _normalize_process_selectors(merged_player),
            raw_player.get("process_selectors", {}),
            PROCESS_SELECTOR_LIST_UI_KEYS,
            PROCESS_SELECTOR_STRING_UI_KEYS,
        )
        merged_player["log_selectors"] = _merge_local_ui_selectors(
            _normalize_log_selectors(merged_player),
            raw_player.get("log_selectors", {}),
            LOG_SELECTOR_LIST_UI_KEYS,
            LOG_SELECTOR_STRING_UI_KEYS,
        )
        merged_player.pop("udp_probe", None)
        merged_players.append(merged_player)

    if not merged_players:
        raise ValueError("Add at least one valid player.")

    existing["node_id"] = node_id
    existing["node_name"] = node_name
    existing["site_id"] = site_id
    existing["hub_url"] = hub_url
    existing["agent_token"] = agent_token
    existing["bootstrap_claim"] = bootstrap_claim
    existing["bootstrap_claim_expires_at"] = bootstrap_claim_expires_at
    existing["enrollment_key"] = enrollment_key
    existing["poll_interval_seconds"] = poll_interval_seconds
    existing["players"] = merged_players
    existing.pop("instances", None)
    existing.pop("identity_locked", None)
    existing.pop("unlock_sensitive_fields", None)
    existing.pop("imported_sensitive_override", None)
    existing.pop("locked_player_ids", None)
    existing.pop("import_setup_url", None)
    return existing


def _render_local_config_ui_html(initial_config: dict[str, Any]) -> bytes:
    initial_json = json.dumps(initial_config, ensure_ascii=True)
    profiles_json = json.dumps(playout_profiles_for_ui(), ensure_ascii=True)
    return (
        LOCAL_CONFIG_UI_TEMPLATE
        .replace("__INITIAL_CONFIG__", initial_json)
        .replace("__PLAYOUT_PROFILES__", profiles_json)
        .encode("utf-8")
    )


_persistent_local_ui_lock = threading.Lock()
_persistent_local_ui_started = False
_runtime_local_config_lock = threading.Lock()
_runtime_local_config_override: dict[str, Any] | None = None
_runtime_suppressed_player_ids: set[str] = set()


def _local_ui_url() -> str:
    return f"http://{LOCAL_UI_HOST}:{LOCAL_UI_PORT}/"


def _open_url_with_startfile(url: str) -> None:
    if not hasattr(os, "startfile"):
        raise OSError("os.startfile is unavailable")
    os.startfile(url)


def _open_url_with_cmd_start(url: str) -> None:
    subprocess.Popen(["cmd.exe", "/c", "start", "", url], close_fds=True)


def _open_url_with_rundll32(url: str) -> None:
    subprocess.Popen(["rundll32.exe", "url.dll,FileProtocolHandler", url], close_fds=True)


def _open_url_in_browser(url: str) -> str | None:
    errors: list[str] = []

    if os.name == "nt":
        for label, opener in (
            ("cmd.exe start", _open_url_with_cmd_start),
            ("os.startfile", _open_url_with_startfile),
            ("rundll32", _open_url_with_rundll32),
        ):
            try:
                opener(url)
                return None
            except Exception as exc:
                errors.append(f"{label} failed: {exc}")

    try:
        if webbrowser.open(url, new=2):
            return None
        errors.append("webbrowser.open returned False")
    except Exception as exc:
        errors.append(f"webbrowser.open failed: {exc}")

    if not errors:
        return "no browser launcher succeeded"

    return "; ".join(errors)


def _wait_for_local_ui(url: str, timeout_seconds: float = 5.0) -> None:
    deadline = time.time() + timeout_seconds
    last_error = "UI did not become available in time."

    while time.time() < deadline:
        try:
            response = requests.get(url, timeout=0.5)
            if response.status_code < 400:
                return
            last_error = f"Unexpected HTTP {response.status_code}"
        except requests.RequestException as exc:
            last_error = str(exc)
        time.sleep(0.2)

    raise RuntimeError(f"Local setup UI was unavailable at {url}: {last_error}")


def _create_local_ui_server(
    handler: type[BaseHTTPRequestHandler],
    preferred_ports: range | list[int] | tuple[int, ...] | None = None,
) -> ThreadingHTTPServer:
    if preferred_ports:
        for port in preferred_ports:
            try:
                return ThreadingHTTPServer((LOCAL_UI_HOST, int(port)), handler)
            except OSError:
                continue

    return ThreadingHTTPServer((LOCAL_UI_HOST, 0), handler)


def _player_ids_from_config(config: dict[str, Any] | None) -> list[str]:
    if not isinstance(config, dict):
        return []

    players = config.get("players")
    if not isinstance(players, list):
        return []

    player_ids: list[str] = []
    for player in players:
        if not isinstance(player, dict):
            continue
        player_id = _as_str(player.get("player_id"))
        if player_id:
            player_ids.append(player_id)
    return player_ids


def _removed_player_ids_between_configs(previous: dict[str, Any] | None, current: dict[str, Any] | None) -> list[str]:
    previous_ids = _player_ids_from_config(previous)
    current_id_set = set(_player_ids_from_config(current))
    return [player_id for player_id in previous_ids if player_id and player_id not in current_id_set]


def _runtime_override_signature(config: dict[str, Any] | None) -> str:
    if not isinstance(config, dict):
        return ""
    try:
        return json.dumps(_build_node_config_mirror(config), sort_keys=True)
    except Exception:
        return ""


def _apply_runtime_local_config_override(
    config: dict[str, Any],
    removed_player_ids: list[str] | tuple[str, ...] | set[str] | None = None,
) -> None:
    global _runtime_local_config_override, _runtime_suppressed_player_ids

    with _runtime_local_config_lock:
        _runtime_local_config_override = copy.deepcopy(config)
        _runtime_suppressed_player_ids = {
            _as_str(player_id)
            for player_id in (removed_player_ids or [])
            if _as_str(player_id)
        }


def _clear_runtime_local_config_override_if_matches(config: dict[str, Any]) -> None:
    global _runtime_local_config_override, _runtime_suppressed_player_ids

    config_signature = _runtime_override_signature(config)
    if not config_signature:
        return

    with _runtime_local_config_lock:
        if _runtime_override_signature(_runtime_local_config_override) != config_signature:
            return
        _runtime_local_config_override = None
        _runtime_suppressed_player_ids = set()


def _current_runtime_local_config_override() -> dict[str, Any] | None:
    with _runtime_local_config_lock:
        if _runtime_local_config_override is None:
            return None
        return copy.deepcopy(_runtime_local_config_override)


def _current_runtime_node_config_mirror(default: dict[str, Any] | None = None) -> dict[str, Any] | None:
    override = _current_runtime_local_config_override()
    if override is not None:
        return _build_node_config_mirror(override)
    return copy.deepcopy(default) if isinstance(default, dict) else None


def _player_is_runtime_suppressed(player_id: str) -> bool:
    with _runtime_local_config_lock:
        return player_id in _runtime_suppressed_player_ids


def _current_local_ui_config() -> dict[str, Any]:
    existing = _load_yaml_if_exists(_runtime_config_path())
    prepared, _ = _prepare_config_for_hub_decommission(existing)
    return _config_for_local_ui(prepared)


def _config_has_enabled_udp(config: dict[str, Any]) -> bool:
    return any(
        _as_bool(udp_input.get("enabled"), False)
        for player in config.get("players", [])
        if isinstance(player, dict)
        for udp_input in player.get("udp_inputs", [])
        if isinstance(udp_input, dict)
    )


def _build_bootstrap_claim_request(config: dict[str, Any], bootstrap_claim: str) -> dict[str, Any]:
    return {
        "bootstrapClaim": bootstrap_claim,
        "nodeId": _as_str(config.get("node_id")),
        "nodeName": _as_str(config.get("node_name")),
        "siteId": _as_str(config.get("site_id")),
    }


def _claim_agent_token_with_bootstrap(config: dict[str, Any], bootstrap_claim: str) -> str:
    hub_url = _as_str(config.get("hub_url")).rstrip("/")
    if not hub_url:
        raise ValueError("Hub URL is required for bootstrap claim exchange.")

    payload = _build_bootstrap_claim_request(config, bootstrap_claim)
    try:
        response = requests.post(f"{hub_url}/api/config/node/bootstrap", json=payload, timeout=20)
    except requests.RequestException as exc:
        raise RuntimeError(f"Bootstrap claim exchange failed: {exc}") from exc

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code >= 400:
        message = _as_str(body.get("error")) if isinstance(body, dict) else ""
        if response.status_code in {401, 403}:
            raise RuntimeError(message or "Bootstrap claim is invalid, expired, or already used.")
        raise RuntimeError(message or f"Bootstrap claim exchange failed with HTTP {response.status_code}.")

    if not isinstance(body, dict):
        raise RuntimeError("Bootstrap claim exchange returned an invalid response.")

    agent_token = _as_str(body.get("agentToken"))
    if not agent_token:
        raise RuntimeError("Bootstrap claim exchange did not return an agent token.")

    return agent_token


def _build_enrollment_request(config: dict[str, Any], enrollment_key: str) -> dict[str, Any]:
    return {
        "enrollmentKey": enrollment_key,
        "nodeId": _as_str(config.get("node_id")),
        "nodeName": _as_str(config.get("node_name")),
        "siteId": _as_str(config.get("site_id")),
        "players": [
            {
                "playerId": _as_str(player.get("player_id")),
                "playoutType": _as_str(player.get("playout_type"), "insta"),
            }
            for player in config.get("players", [])
            if isinstance(player, dict) and _as_str(player.get("player_id"))
        ],
    }


def _enroll_node_with_hub(config: dict[str, Any], enrollment_key: str) -> str:
    hub_url = _as_str(config.get("hub_url")).rstrip("/")
    if not hub_url:
        raise ValueError("Hub URL is required for enrollment.")

    payload = _build_enrollment_request(config, enrollment_key)
    try:
        response = requests.post(f"{hub_url}/api/config/enroll", json=payload, timeout=20)
    except requests.RequestException as exc:
        raise RuntimeError(f"Hub enrollment failed: {exc}") from exc

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code >= 400:
        message = _as_str(body.get("error")) if isinstance(body, dict) else ""
        if response.status_code == 403:
            hint = " If this node was already provisioned from the remote dashboard, upload the downloaded config.yaml here instead of using the enrollment key."
            raise RuntimeError((message or "Enrollment key was rejected by the hub.") + hint)
        raise RuntimeError(message or f"Hub enrollment failed with HTTP {response.status_code}.")

    if not isinstance(body, dict):
        raise RuntimeError("Hub enrollment returned an invalid response.")

    agent_token = _as_str(body.get("agentToken"))
    if not agent_token:
        raise RuntimeError("Hub enrollment did not return an agent token.")

    return agent_token


def _materialize_local_ui_config(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    config = _normalize_local_ui_submission(payload, existing)
    if _as_str(config.get("agent_token")):
        return config

    bootstrap_claim = _as_non_placeholder_str(config.get("bootstrap_claim"))
    if bootstrap_claim:
        config["agent_token"] = _claim_agent_token_with_bootstrap(config, bootstrap_claim)
        config["bootstrap_claim"] = ""
        config["bootstrap_claim_expires_at"] = ""
        return config

    enrollment_key = _as_str(config.get("enrollment_key"))
    if not enrollment_key:
        return config

    config["agent_token"] = _enroll_node_with_hub(config, enrollment_key)
    config["bootstrap_claim"] = ""
    config["bootstrap_claim_expires_at"] = ""
    return config


def _save_local_ui_config(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    config_path = _runtime_config_path()
    existing = _load_yaml_if_exists(config_path)
    config = _materialize_local_ui_config(payload, existing)
    _write_yaml(config_path, config)
    removed_player_ids = _removed_player_ids_between_configs(existing, config)
    _apply_runtime_local_config_override(config, removed_player_ids)

    _ensure_ff_tools(required=_config_has_enabled_udp(config))

    sync_result = _sync_node_config_mirror_to_hub(config)
    token_refreshed = False
    if not sync_result.get("ok") and _is_hub_unauthorized(sync_result):
        refreshed_token, refresh_error = _refresh_agent_token_from_bootstrap_claim(
            config,
            "Hub sync unauthorized",
        )
        if not refreshed_token:
            refreshed_token, refresh_error = _refresh_agent_token_from_enrollment(
                config,
                "Hub sync unauthorized",
            )
        if refreshed_token:
            config["agent_token"] = refreshed_token
            _write_yaml(config_path, config)
            _apply_runtime_local_config_override(config, removed_player_ids)
            sync_result = _sync_node_config_mirror_to_hub(config)
            token_refreshed = bool(sync_result.get("ok"))
        elif refresh_error:
            sync_result["error"] = refresh_error

    if sync_result.get("ok"):
        if removed_player_ids:
            message = "Local settings saved. Removed players were removed from the hub immediately."
        else:
            message = "Local settings saved. Hub details updated immediately."
        if token_refreshed:
            message = "Local settings saved. Agent token was refreshed and hub details updated immediately."
    else:
        details = _as_str(sync_result.get("error"))
        if details == "Hub URL or agent token is missing.":
            message = "Local settings saved. Import a provisioned setup link/config to activate hub registration."
        else:
            message = "Local settings saved. Hub sync will retry on the next heartbeat."
        if details:
            message = f"{message} ({details})"

    return _config_for_local_ui(config), message


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
                if self.path not in {"/api/save", "/api/import", "/api/import-url"}:
                    self._send_json(404, {"error": "Not found"})
                    return

                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length)

                try:
                    payload = json.loads(raw_body.decode("utf-8"))
                    if self.path == "/api/import":
                        config, message = _import_local_ui_state(
                            payload.get("documentText"),
                            payload.get("currentState"),
                        )
                        self._send_json(200, {"ok": True, "config": config, "message": message})
                        return
                    if self.path == "/api/import-url":
                        config, message = _pull_remote_setup_url(
                            payload.get("setupUrl"),
                            payload.get("currentState"),
                        )
                        self._send_json(200, {"ok": True, "config": config, "message": message})
                        return

                    config, message = _save_local_ui_config(payload)
                except Exception as exc:
                    self._send_json(400, {"error": str(exc)})
                    return

                self._send_json(200, {"ok": True, "config": config, "message": message})

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


def _run_local_config_ui(
    existing: dict[str, Any] | None = None,
    preferred_ports: range | list[int] | tuple[int, ...] | None = None,
) -> dict[str, Any]:
    defaults_search_roots = [
        _base_dir(),
        _bundle_path(""),
        _installed_path(""),
        os.path.dirname(_runtime_config_path()),
    ]
    prepared_existing, _ = _apply_pulse_account_defaults(existing, defaults_search_roots)
    initial_config = _config_for_local_ui(prepared_existing)
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
            if self.path not in {"/api/save", "/api/import", "/api/import-url"}:
                self._send_json(404, {"error": "Not found"})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)

            try:
                payload = json.loads(raw_body.decode("utf-8"))
                if self.path == "/api/import":
                    config, message = _import_local_ui_state(
                        payload.get("documentText"),
                        payload.get("currentState", initial_config),
                    )
                    initial_config.clear()
                    initial_config.update(config)
                    self._send_json(200, {"ok": True, "config": initial_config, "message": message})
                    return
                if self.path == "/api/import-url":
                    config, message = _pull_remote_setup_url(
                        payload.get("setupUrl"),
                        payload.get("currentState", initial_config),
                    )
                    initial_config.clear()
                    initial_config.update(config)
                    self._send_json(200, {"ok": True, "config": initial_config, "message": message})
                    return

                config = _materialize_local_ui_config(payload, prepared_existing)
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

    server = _create_local_ui_server(ConfigUiHandler, preferred_ports=preferred_ports)
    server.timeout = 1
    url = f"http://{LOCAL_UI_HOST}:{server.server_address[1]}/"
    print()
    print("Pulse local setup is opening in your browser.")
    print(f"If it does not open automatically, visit: {url}")

    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True)
    thread.start()
    _wait_for_local_ui(url)

    launch_error = _open_url_in_browser(url)
    if launch_error:
        print(f"Unable to open your browser automatically: {launch_error}")
        print(f"Open this URL manually: {url}")

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
    preferred_ports = [LOCAL_UI_PORT, *range(TEMP_LOCAL_UI_PORT_START, TEMP_LOCAL_UI_PORT_END + 1)]
    try:
        return _run_local_config_ui(existing, preferred_ports=preferred_ports)
    except Exception as exc:
        print(f"Local setup UI was unavailable: {exc}")
        print("Falling back to the console wizard.")
        return _run_config_wizard(existing)


def _run_bundle_config_editor(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return _run_local_config_ui(
            existing,
            preferred_ports=range(TEMP_LOCAL_UI_PORT_START, TEMP_LOCAL_UI_PORT_END + 1),
        )
    except Exception as exc:
        print(f"Temporary local setup UI was unavailable: {exc}")
        print("Falling back to the console wizard.")
        return _run_config_wizard(existing)


def _import_local_ui_state_from_path(import_path: str, current_state: dict[str, Any] | None = None) -> tuple[dict[str, Any], str]:
    resolved_path = os.path.abspath(_as_str(import_path))
    if not resolved_path:
        raise ValueError("Discovery report path is required.")
    if not os.path.isfile(resolved_path):
        raise FileNotFoundError(f"Discovery report not found at {resolved_path}")

    with open(resolved_path, "r", encoding="utf-8-sig") as handle:
        document_text = handle.read()

    return _import_local_ui_state(document_text, current_state)


def _load_pulse_account_defaults(search_roots: list[str]) -> dict[str, str]:
    def _extract_from_document(document: dict[str, Any]) -> dict[str, str]:
        hub_url = _as_non_placeholder_str(document.get("hubUrl") or document.get("hub_url"))
        enrollment_key = _as_non_placeholder_str(
            document.get("enrollmentKey") or document.get("enrollment_key")
        )
        bootstrap_claim = _as_non_placeholder_str(
            document.get("bootstrapClaim")
            or document.get("bootstrap_claim")
            or document.get("claim"),
        )
        bootstrap_claim_expires_at = _as_str(
            document.get("bootstrapClaimExpiresAt")
            or document.get("bootstrap_claim_expires_at")
            or document.get("bootstrapClaimExpiry")
            or document.get("bootstrap_claim_expiry"),
        )
        if not hub_url and not enrollment_key and not bootstrap_claim:
            return {}
        return {
            "hub_url": hub_url,
            "enrollment_key": enrollment_key,
            "bootstrap_claim": bootstrap_claim,
            "bootstrap_claim_expires_at": bootstrap_claim_expires_at,
        }

    def _extract_from_readme(readme_text: str) -> dict[str, str]:
        match = re.search(
            r"\[PULSE_ACCOUNT_JSON_START\]\s*(\{[\s\S]*?\})\s*\[PULSE_ACCOUNT_JSON_END\]",
            readme_text,
        )
        if not match:
            return {}
        try:
            parsed = json.loads(match.group(1))
        except ValueError:
            return {}
        if not isinstance(parsed, dict):
            return {}
        return _extract_from_document(parsed)

    candidate_paths: list[tuple[str, str]] = []
    for root in search_roots:
        normalized_root = _as_str(root)
        if not normalized_root:
            continue
        candidate_paths.append((os.path.join(normalized_root, "pulse-account.json"), "json"))
        candidate_paths.append((os.path.join(normalized_root, "README.txt"), "readme"))

    merged_defaults = {
        "hub_url": "",
        "enrollment_key": "",
        "bootstrap_claim": "",
        "bootstrap_claim_expires_at": "",
        "source_path": "",
    }
    seen: set[str] = set()
    for candidate, candidate_kind in candidate_paths:
        resolved = os.path.abspath(candidate)
        lowered = resolved.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        if not os.path.isfile(resolved):
            continue
        try:
            with open(resolved, "r", encoding="utf-8-sig") as handle:
                content = handle.read()
        except (OSError, ValueError):
            continue

        defaults: dict[str, str]
        if candidate_kind == "json":
            try:
                document = json.loads(content)
            except ValueError:
                continue
            if not isinstance(document, dict):
                continue
            defaults = _extract_from_document(document)
        else:
            defaults = _extract_from_readme(content)

        if not defaults:
            continue

        if defaults.get("hub_url") and not merged_defaults["hub_url"]:
            merged_defaults["hub_url"] = defaults["hub_url"]
        if defaults.get("enrollment_key") and not merged_defaults["enrollment_key"]:
            merged_defaults["enrollment_key"] = defaults["enrollment_key"]
        if defaults.get("bootstrap_claim") and not merged_defaults["bootstrap_claim"]:
            merged_defaults["bootstrap_claim"] = defaults["bootstrap_claim"]
        if (
            defaults.get("bootstrap_claim_expires_at")
            and not merged_defaults["bootstrap_claim_expires_at"]
        ):
            merged_defaults["bootstrap_claim_expires_at"] = defaults["bootstrap_claim_expires_at"]
        if not merged_defaults["source_path"]:
            merged_defaults["source_path"] = resolved

        if (
            merged_defaults["hub_url"]
            and (
                merged_defaults["enrollment_key"]
                or merged_defaults["bootstrap_claim"]
            )
        ):
            break

    if (
        not merged_defaults["hub_url"]
        and not merged_defaults["enrollment_key"]
        and not merged_defaults["bootstrap_claim"]
    ):
        return {}

    return merged_defaults


def _apply_pulse_account_defaults(
    state: dict[str, Any] | None,
    search_roots: list[str],
) -> tuple[dict[str, Any], str | None]:
    current = copy.deepcopy(state) if isinstance(state, dict) else {}
    defaults = _load_pulse_account_defaults(search_roots)
    if not defaults:
        return current, None

    applied_fields: list[str] = []
    if defaults.get("hub_url") and not _as_non_placeholder_str(current.get("hub_url")):
        current["hub_url"] = defaults["hub_url"]
        applied_fields.append("hub URL")
    if defaults.get("enrollment_key") and not _as_non_placeholder_str(current.get("enrollment_key")):
        current["enrollment_key"] = defaults["enrollment_key"]
        applied_fields.append("enrollment key")
    if defaults.get("bootstrap_claim") and not _as_non_placeholder_str(current.get("bootstrap_claim")):
        current["bootstrap_claim"] = defaults["bootstrap_claim"]
        if defaults.get("bootstrap_claim_expires_at"):
            current["bootstrap_claim_expires_at"] = defaults["bootstrap_claim_expires_at"]
        applied_fields.append("bootstrap claim")
    elif (
        defaults.get("bootstrap_claim_expires_at")
        and _as_non_placeholder_str(current.get("bootstrap_claim"))
        and not _as_str(current.get("bootstrap_claim_expires_at"))
    ):
        current["bootstrap_claim_expires_at"] = defaults["bootstrap_claim_expires_at"]

    if not applied_fields:
        return current, None

    source_path = defaults.get("source_path") or "pulse-account.json"
    return current, (
        f"Loaded {' and '.join(applied_fields)} from {source_path}."
    )


def _decommission_candidate_paths(search_roots: list[str]) -> list[str]:
    candidate_roots: list[str] = []
    for root in search_roots:
        normalized_root = _as_str(root)
        if normalized_root:
            candidate_roots.append(normalized_root)

    local_app_data = _as_str(os.environ.get("LOCALAPPDATA"))
    if local_app_data:
        candidate_roots.extend(
            [
                os.path.join(local_app_data, "ClarixPulse", "Bundles"),
                os.path.join(local_app_data, "ClarixPulse", "Bundles", "clarix-pulse"),
            ]
        )

    candidate_roots.extend(
        [
            os.path.join(r"C:\pulse-node-bundle"),
            os.path.join(r"C:\pulse-node-bundle", "clarix-pulse"),
        ]
    )

    candidate_paths: list[str] = []
    for root in candidate_roots:
        candidate_paths.extend(
            [
                os.path.join(root, "config.yaml"),
                os.path.join(root, "pulse-node-discovery-report.json"),
                os.path.join(root, "pulse-discovery-report.json"),
            ]
        )

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidate_paths:
        resolved = os.path.abspath(candidate)
        lowered = resolved.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(resolved)

    return deduped


def _decommission_document_from_path(path: str) -> dict[str, Any]:
    if not os.path.isfile(path):
        return {}

    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            if path.lower().endswith(".json"):
                parsed = json.load(handle)
            else:
                parsed = yaml.safe_load(handle) or {}
    except (OSError, ValueError, yaml.YAMLError):
        return {}

    return parsed if isinstance(parsed, dict) else {}


def _extract_decommission_defaults(document: dict[str, Any]) -> dict[str, str]:
    nested_existing = {}
    discovery = document.get("discovery")
    if isinstance(discovery, dict) and isinstance(discovery.get("existing_pulse_config"), dict):
        nested_existing = discovery.get("existing_pulse_config", {})

    lookup_docs = [document]
    if nested_existing:
        lookup_docs.append(nested_existing)

    def _first_string(keys: list[str], *, allow_placeholders: bool = False) -> str:
        for source in lookup_docs:
            for key in keys:
                value = (
                    _as_str(source.get(key))
                    if allow_placeholders
                    else _as_non_placeholder_str(source.get(key))
                )
                if value:
                    return value
        return ""

    return {
        "node_id": _first_string(["node_id", "nodeId", "agent_id"], allow_placeholders=True),
        "node_name": _first_string(["node_name", "nodeName", "pc_name"], allow_placeholders=True),
        "site_id": _first_string(["site_id", "siteId"], allow_placeholders=True),
        "hub_url": _first_string(["hub_url", "hubUrl"]),
        "agent_token": _first_string(["agent_token", "agentToken"]),
        "bootstrap_claim": _first_string(["bootstrap_claim", "bootstrapClaim"]),
        "bootstrap_claim_expires_at": _first_string(["bootstrap_claim_expires_at", "bootstrapClaimExpiresAt"], allow_placeholders=True),
        "enrollment_key": _first_string(["enrollment_key", "enrollmentKey"]),
    }


def _apply_decommission_config_defaults(
    state: dict[str, Any] | None,
    search_roots: list[str],
) -> tuple[dict[str, Any], str | None]:
    current = copy.deepcopy(state) if isinstance(state, dict) else {}

    gathered: dict[str, str] = {
        "node_id": "",
        "node_name": "",
        "site_id": "",
        "hub_url": "",
        "agent_token": "",
        "bootstrap_claim": "",
        "bootstrap_claim_expires_at": "",
        "enrollment_key": "",
    }
    for candidate_path in _decommission_candidate_paths(search_roots):
        document = _decommission_document_from_path(candidate_path)
        if not document:
            continue

        defaults = _extract_decommission_defaults(document)
        for field_name, value in defaults.items():
            if value and not gathered[field_name]:
                gathered[field_name] = value

        if all(gathered.values()):
            break

    applied_fields: list[str] = []
    field_labels = {
        "node_id": "node ID",
        "node_name": "node name",
        "site_id": "site ID",
        "hub_url": "hub URL",
        "agent_token": "agent token",
        "bootstrap_claim": "bootstrap claim",
        "bootstrap_claim_expires_at": "bootstrap claim expiry",
        "enrollment_key": "enrollment key",
    }
    for field_name, value in gathered.items():
        if not value:
            continue
        current_value = (
            _as_str(current.get(field_name))
            if field_name in {"node_id", "node_name", "site_id"}
            else _as_non_placeholder_str(current.get(field_name))
        )
        if current_value:
            continue
        current[field_name] = value
        applied_fields.append(field_labels[field_name])

    if not applied_fields:
        return current, None

    return current, (
        f"Loaded {' and '.join(applied_fields)} from nearby Pulse config files."
    )


def _prepare_config_for_hub_decommission(raw_config: dict[str, Any] | None) -> tuple[dict[str, Any], str | None]:
    config = copy.deepcopy(raw_config) if isinstance(raw_config, dict) else {}
    runtime_config_path = _runtime_config_path()
    search_roots = [
        os.path.dirname(os.path.abspath(runtime_config_path)),
        INSTALL_DIR,
        _base_dir(),
        os.getcwd(),
    ]
    config, account_message = _apply_pulse_account_defaults(config, search_roots)
    config, config_message = _apply_decommission_config_defaults(config, search_roots)
    messages = [message for message in (account_message, config_message) if message]
    return config, " ".join(messages) if messages else None


def configure_bundle_command(import_path: str | None = None) -> int:
    try:
        config_path = _bundle_path("config.yaml")
        existing = _load_yaml_if_exists(config_path)
        initial_state = existing

        if import_path:
            initial_state, message = _import_local_ui_state_from_path(import_path, existing)
            print(message)

        initial_state, account_message = _apply_pulse_account_defaults(
            initial_state,
            [
                os.path.dirname(os.path.abspath(config_path)),
                os.getcwd(),
            ],
        )
        if account_message:
            print(account_message)

        configured = _run_bundle_config_editor(initial_state)
        _write_yaml(config_path, configured)
        validated_config = load_config(config_path)

        print()
        print("Pulse bundle configuration updated.")
        print(f"Node: {validated_config['node_id']} ({validated_config['node_name']})")
        print(f"Saved to: {config_path}")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


def open_local_ui_command() -> int:
    url = _local_ui_url()

    try:
        _wait_for_local_ui(url, timeout_seconds=15.0)
    except RuntimeError:
        print(f"Persistent local UI is not running at {url}")
        return 2

    launch_error = _open_url_in_browser(url)
    if launch_error:
        print(f"Unable to open your browser automatically: {launch_error}")
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
    playout_choices = [profile["id"] for profile in playout_profiles_for_ui()]
    existing_type = normalize_playout_type(existing_player.get("playout_type") or DEFAULT_PLAYOUT_TYPE)
    playout_type = _prompt_choice(
        f"Player {index + 1} playout type",
        playout_choices,
        existing_type if existing_type in playout_choices else DEFAULT_PLAYOUT_TYPE,
    )
    player_id = _prompt(
        f"Player {index + 1} ID",
        _as_str(existing_player.get("player_id"), _default_player_id(node_id, playout_type, index)),
        required=True,
    )

    existing_paths = _as_mapping(existing_player.get("paths"))
    ui_mode = str(get_playout_profile(playout_type).get("ui_mode") or "generic")
    if ui_mode == "insta":
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
            "fnf_log": _prompt(
                f"{player_id} fnf_log",
                _as_str(existing_paths.get("fnf_log")),
                required=False,
            ),
            "playlistscan_log": _prompt(
                f"{player_id} playlistscan_log",
                _as_str(existing_paths.get("playlistscan_log")),
                required=False,
            ),
        }
    elif ui_mode == "admax":
        detected_root = _best_existing_dir(_default_admax_root_patterns())
        paths = {
            "admax_root_candidates": [
                _prompt(
                    f"{player_id} Admax root",
                    _as_str(existing_paths.get("admax_root"), detected_root),
                    required=True,
                )
            ],
            "fnf_log": _prompt(
                f"{player_id} fnf_log",
                _as_str(existing_paths.get("fnf_log")),
                required=False,
            ),
            "playlistscan_log": _prompt(
                f"{player_id} playlistscan_log",
                _as_str(existing_paths.get("playlistscan_log")),
                required=False,
            ),
        }
    else:
        paths = {
            "log_path": _prompt(
                f"{player_id} primary log file/folder",
                _as_str(existing_paths.get("log_path")),
                required=False,
            ),
            "fnf_log": _prompt(
                f"{player_id} content error log",
                _as_str(existing_paths.get("fnf_log")),
                required=False,
            ),
            "playlistscan_log": _prompt(
                f"{player_id} secondary/scan log",
                _as_str(existing_paths.get("playlistscan_log")),
                required=False,
            ),
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
        _as_int(existing.get("poll_interval_seconds"), DEFAULT_POLL_INTERVAL_SECONDS),
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

    for filename in (
        "install.bat",
        "configure.bat",
        "uninstall.bat",
        "remove-pulse-agent.ps1",
        "config.example.yaml",
        "pulse-account.json",
        "README.txt",
        "confidence_scorer.py",
        "learning_store.py",
        "fingerprint_manifest.json",
    ):
        _copy_if_exists(_bundle_path(filename), _installed_path(filename))

    return staged_exe


def score_discovery_command(input_path: str | None = None, db_path: str | None = None) -> int:
    payload_path = input_path or "-"
    if payload_path == "-":
        payload = json.load(sys.stdin)
    else:
        with open(payload_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)

    result = score_detection_payload(payload, db_path=db_path or None)
    print(json.dumps(result, separators=(",", ":")))
    return 0


def _command_option_value(args: list[str], option_name: str, default: str | None = None) -> str | None:
    try:
        option_index = args.index(option_name)
    except ValueError:
        return default

    next_index = option_index + 1
    if next_index >= len(args):
        return default

    value = args[next_index]
    if value.startswith("--"):
        return default

    return value


def _load_or_prepare_config(config_path: str) -> dict[str, Any]:
    config_exists = os.path.exists(config_path)
    existing = _load_yaml_if_exists(config_path)
    if not existing and os.path.exists(_bundle_path("config.yaml")):
        _copy_if_exists(_bundle_path("config.yaml"), config_path)
        existing = _load_yaml_if_exists(config_path)
        config_exists = os.path.exists(config_path)

    existing_before_defaults = copy.deepcopy(existing) if isinstance(existing, dict) else {}
    existing, account_message = _apply_pulse_account_defaults(
        existing,
        [
            os.path.dirname(os.path.abspath(config_path)),
            INSTALL_DIR,
            _base_dir(),
            os.getcwd(),
        ],
    )
    if account_message:
        print(account_message)
    if config_exists and existing != existing_before_defaults:
        _write_yaml(config_path, existing)

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
    try:
        config_path = _bundle_path("config.yaml")
        bundle_config = _load_yaml_if_exists(config_path)
        if os.path.exists(_installed_path("config.yaml")) and (not bundle_config or _contains_placeholder(bundle_config)):
            _copy_if_exists(_installed_path("config.yaml"), config_path)
        _load_or_prepare_config(config_path)
        load_config(config_path)
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    if not _is_admin():
        print()
        print("Pulse configuration is ready.")
        print("Windows will ask for one Administrator approval to finish installing the service.")
        return _relaunch_as_admin(["--install-service-admin"])

    return install_service_admin_command()


def install_service_admin_command() -> int:
    try:
        nssm_path = _ensure_nssm()
        _stop_existing_service(nssm_path)
        staged_exe = _stage_runtime_files()
        config_path = _installed_path("config.yaml")
        if os.path.exists(_bundle_path("config.yaml")):
            _copy_if_exists(_bundle_path("config.yaml"), config_path)
        _load_or_prepare_config(config_path)
        validated_config = load_config(config_path)
        _ensure_ff_tools(required=_config_has_enabled_udp(validated_config))

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
        _write_windows_uninstall_registration(INSTALL_DIR)

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

        _ensure_ff_tools(required=_config_has_enabled_udp(configured))

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
        raw_config = _load_yaml_if_exists(_runtime_config_path())
        decommission_config, account_message = _prepare_config_for_hub_decommission(raw_config)
        if account_message:
            print(account_message)
        _sanitize_local_enrollment_credentials()
        _remove_windows_uninstall_registration()
        existing_config = _config_for_hub_sync(decommission_config)
        nssm_path = _installed_path("nssm.exe") if os.path.exists(_installed_path("nssm.exe")) else ""
        _stop_existing_service(nssm_path or None)

        if isinstance(decommission_config, dict) and decommission_config:
            cleanup_result = _decommission_node_from_hub(decommission_config)
            cleanup_ok = bool(cleanup_result.get("ok"))
            cleanup_error = _as_str(cleanup_result.get("error"))

            if not cleanup_ok and _is_hub_unauthorized(cleanup_result):
                refreshed_token, refresh_error = _refresh_agent_token_from_bootstrap_claim(
                    decommission_config,
                    "Hub decommission unauthorized",
                )
                if not refreshed_token:
                    refreshed_token, refresh_error = _refresh_agent_token_from_enrollment(
                        decommission_config,
                        "Hub decommission unauthorized",
                    )
                if refreshed_token:
                    decommission_config["agent_token"] = refreshed_token
                    cleanup_result = _decommission_node_from_hub(decommission_config)
                    cleanup_ok = bool(cleanup_result.get("ok"))
                    cleanup_error = _as_str(cleanup_result.get("error"))
                elif refresh_error:
                    cleanup_error = refresh_error

            # Older hubs may not have /api/config/node/decommission yet.
            if not cleanup_ok and existing_config is not None and cleanup_error.startswith("HTTP 404"):
                mirror_result = _sync_node_config_mirror_to_hub(existing_config, players_override=[])
                mirror_ok = bool(mirror_result.get("ok"))
                mirror_error = _as_str(mirror_result.get("error"))
                if mirror_ok:
                    cleanup_error = (
                        "Hub decommission endpoint unavailable (HTTP 404). "
                        "Player records were synced for cleanup, but node removal is not supported by this hub."
                    )
                elif mirror_error:
                    cleanup_error = mirror_error

            if cleanup_ok:
                removed_count = len(cleanup_result.get("removed_player_ids", []))
                if removed_count > 0:
                    print(f"Removed {removed_count} player(s) from the hub immediately.")
            elif cleanup_error:
                print(
                    "WARNING: Pulse was removed locally, but hub cleanup failed: "
                    f"{cleanup_error}. Remove the stale node from Dashboard > Remote Setup > Hub cleanup."
                )

        cleanup_incomplete = _cleanup_uninstall_artifacts()

        if cleanup_incomplete:
            print("ERROR: Pulse uninstall could not remove all local artifacts.")
            print("Close any Clarix/Pulse processes and run uninstall again.")
            return 1

        print("Pulse uninstalled.")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


def decommission_hub_command() -> int:
    try:
        raw_config = _load_yaml_if_exists(_runtime_config_path())
        decommission_config, account_message = _prepare_config_for_hub_decommission(raw_config)
        if account_message:
            print(account_message)
        if not isinstance(decommission_config, dict) or not decommission_config:
            print("ERROR: No runtime config was found. Hub decommission was skipped.")
            return 1

        existing_config = _config_for_hub_sync(decommission_config)
        cleanup_result = _decommission_node_from_hub(decommission_config)
        cleanup_ok = bool(cleanup_result.get("ok"))
        cleanup_error = _as_str(cleanup_result.get("error"))

        if not cleanup_ok and _is_hub_unauthorized(cleanup_result):
            refreshed_token, refresh_error = _refresh_agent_token_from_enrollment(
                decommission_config,
                "Hub decommission unauthorized",
            )
            if refreshed_token:
                decommission_config["agent_token"] = refreshed_token
                cleanup_result = _decommission_node_from_hub(decommission_config)
                cleanup_ok = bool(cleanup_result.get("ok"))
                cleanup_error = _as_str(cleanup_result.get("error"))
            elif refresh_error:
                cleanup_error = refresh_error

        # Older hubs may not have /api/config/node/decommission yet.
        if not cleanup_ok and existing_config is not None and cleanup_error.startswith("HTTP 404"):
            mirror_result = _sync_node_config_mirror_to_hub(existing_config, players_override=[])
            mirror_ok = bool(mirror_result.get("ok"))
            mirror_error = _as_str(mirror_result.get("error"))
            if mirror_ok:
                cleanup_error = (
                    "Hub decommission endpoint unavailable (HTTP 404). "
                    "Player records were synced for cleanup, but node removal is not supported by this hub."
                )
            elif mirror_error:
                cleanup_error = mirror_error

        if cleanup_ok:
            removed_count = len(cleanup_result.get("removed_player_ids", []))
            print(
                "Hub decommission complete for this node."
                if removed_count == 0
                else f"Hub decommission complete. Removed {removed_count} player record(s)."
            )
            return 0

        print(f"ERROR: Hub decommission failed: {cleanup_error or 'Unknown error.'}")
        return 1
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

def _should_retry_http_status(status_code: int) -> bool:
    return status_code in RETRYABLE_HTTP_STATUS_CODES


def _post_json_with_retry(
    url: str,
    token: str,
    payload: dict[str, Any],
    log_label: str,
    timeout_seconds: int = HEARTBEAT_POST_TIMEOUT_SECONDS,
    retry_delays_seconds: tuple[float, ...] = HEARTBEAT_RETRY_DELAYS_SECONDS,
) -> requests.Response:
    headers = {"Authorization": f"Bearer {token}"}
    attempts = len(retry_delays_seconds) + 1

    for attempt_index in range(attempts):
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=timeout_seconds)
        except requests.RequestException as error:
            if attempt_index >= len(retry_delays_seconds):
                raise

            delay_seconds = retry_delays_seconds[attempt_index]
            log.warning(
                f"{log_label} failed ({error}); retrying in {delay_seconds:.1f}s "
                f"(attempt {attempt_index + 2}/{attempts})"
            )
            time.sleep(delay_seconds)
            continue

        if response.status_code == 200 or attempt_index >= len(retry_delays_seconds):
            return response

        if not _should_retry_http_status(response.status_code):
            return response

        delay_seconds = retry_delays_seconds[attempt_index]
        log.warning(
            f"{log_label} temporary failure ({response.status_code}); retrying in {delay_seconds:.1f}s "
            f"(attempt {attempt_index + 2}/{attempts})"
        )
        time.sleep(delay_seconds)

    raise RuntimeError(f"{log_label} retry loop exited unexpectedly")


class HubUnauthorizedError(RuntimeError):
    pass


def post_heartbeat(
    hub_url: str,
    token: str,
    node_id: str,
    player_id: str,
    observations: dict[str, Any],
    node_config_mirror: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, int | None]:
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
        if isinstance(node_config_mirror, dict) and isinstance(node_config_mirror.get("players"), list):
            payload["playerManifest"] = [
                _as_str(player.get("player_id"))
                for player in node_config_mirror.get("players", [])
                if isinstance(player, dict) and _as_str(player.get("player_id"))
            ]
    try:
        r = _post_json_with_retry(
            url,
            token,
            payload,
            f"Heartbeat POST for {player_id}",
        )
        if r.status_code == 200:
            try:
                payload = r.json()
            except ValueError:
                payload = {}
            return payload if isinstance(payload, dict) else {}, 200
        log.warning(f"Heartbeat rejected for {player_id}: {r.status_code} {r.text[:200]}")
        return None, r.status_code
    except requests.RequestException as e:
        log.warning(f"Heartbeat POST failed for {player_id}: {e}")
        return None, None


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
        requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=HEARTBEAT_POST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        log.debug(f"Thumbnail POST failed for {player_id}/{udp_input_id}: {e}")


# --- Player polling ------------------------------------------------------------

_last_thumbnail_at: dict[str, float] = {}
UDP_PROBE_MAX_WORKERS = 4


def _thumbnail_key(node_id: str, player_id: str, udp_input_id: str) -> str:
    return f"{node_id}:{player_id}:{udp_input_id}"


def _udp_rank(result: dict[str, Any]) -> tuple[int, float, float, float, int]:
    metrics = result.get("metrics", {})
    present = 1 if metrics.get("output_signal_present") == 1 else 0
    freeze = float(metrics.get("output_freeze_seconds") or 0.0)
    black = float(metrics.get("output_black_ratio") or 0.0)
    silence = float(metrics.get("output_audio_silence_seconds") or 0.0)
    source_order = int(result.get("source_order") or 0)
    return (present, -freeze, -black, -silence, -source_order)


def _probe_udp_input(
    player_id: str,
    udp_input_id: str,
    stream_url: str,
    thumbnail_interval: int,
    source_order: int,
) -> tuple[dict[str, Any], dict[str, Any] | None, bool]:
    entry: dict[str, Any] = {
        "udp_input_id": udp_input_id,
        "enabled": True,
        "stream_url_present": True,
    }

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

        candidate = {
            "udp_input_id": udp_input_id,
            "stream_url": stream_url,
            "thumbnail_interval_s": thumbnail_interval,
            "metrics": metrics,
            "source_order": source_order,
        }
        return entry, candidate, healthy
    except Exception as e:
        entry["error"] = str(e)
        log.debug(f"[{player_id}/{udp_input_id}] UDP probe error: {e}")
        return entry, None, False


def _collect_udp_matrix(
    player_id: str,
    udp_inputs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, int, int]:
    matrix: list[dict[str, Any] | None] = [None] * len(udp_inputs)
    candidates: list[dict[str, Any]] = []
    configured_count = 0
    healthy_count = 0
    probe_jobs: list[tuple[int, str, str, int]] = []

    for index, udp_input in enumerate(udp_inputs):
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
            matrix[index] = entry
            continue

        if not stream_url:
            entry["error"] = "missing stream_url"
            matrix[index] = entry
            continue

        configured_count += 1
        probe_jobs.append((index, udp_input_id, stream_url, thumbnail_interval))

    if probe_jobs:
        max_workers = min(UDP_PROBE_MAX_WORKERS, len(probe_jobs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(_probe_udp_input, player_id, udp_input_id, stream_url, thumbnail_interval, index): index
                for index, udp_input_id, stream_url, thumbnail_interval in probe_jobs
            }
            for future in as_completed(future_map):
                index = future_map[future]
                entry, candidate, healthy = future.result()
                matrix[index] = entry
                if candidate:
                    candidates.append(candidate)
                if healthy:
                    healthy_count += 1

    primary: dict[str, Any] | None = None
    if candidates:
        primary = max(candidates, key=_udp_rank)

    return [entry for entry in matrix if entry is not None], primary, configured_count, healthy_count


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
        "poll_interval_seconds": int(config.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS)),
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


def _sync_node_config_mirror_to_hub(
    config: dict[str, Any],
    players_override: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    hub_url = _as_str(config.get("hub_url")).rstrip("/")
    token = _as_non_placeholder_str(config.get("agent_token"))
    if not token:
        refreshed_token, _ = _refresh_agent_token_from_bootstrap_claim(
            config,
            "Hub sync missing agent token",
        )
        if refreshed_token:
            token = refreshed_token
            config["agent_token"] = refreshed_token
    if not hub_url or not token:
        return {
            "ok": False,
            "removed_player_ids": [],
            "updated_at": "",
            "error": "Hub URL or agent token is missing.",
            "status_code": None,
        }

    mirror_config = copy.deepcopy(config)
    if players_override is not None:
        mirror_config["players"] = copy.deepcopy(players_override)
    payload = _build_node_config_mirror(mirror_config)

    try:
        response = _post_json_with_retry(
            f"{hub_url}/api/config/node/mirror",
            token,
            payload,
            f"Node mirror sync for {mirror_config.get('node_id', 'node')}",
            timeout_seconds=20,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "removed_player_ids": [],
            "updated_at": "",
            "error": str(exc),
            "status_code": None,
        }

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code >= 400:
        error_message = _as_str(body.get("error")) if isinstance(body, dict) else ""
        return {
            "ok": False,
            "removed_player_ids": [],
            "updated_at": "",
            "error": error_message or f"HTTP {response.status_code}",
            "status_code": response.status_code,
        }

    removed_player_ids = []
    if isinstance(body, dict) and isinstance(body.get("removedPlayerIds"), list):
        removed_player_ids = [
            _as_str(player_id)
            for player_id in body.get("removedPlayerIds", [])
            if _as_str(player_id)
        ]

    return {
        "ok": True,
        "removed_player_ids": removed_player_ids,
        "updated_at": _as_str(body.get("updatedAt")) if isinstance(body, dict) else "",
        "error": "",
        "status_code": response.status_code,
    }


def _is_hub_unauthorized(result: dict[str, Any]) -> bool:
    status_code = result.get("status_code")
    if isinstance(status_code, int) and status_code == 401:
        return True
    error_text = _as_str(result.get("error")).lower()
    return "unauthorized" in error_text


def _refresh_agent_token_from_bootstrap_claim(
    config: dict[str, Any],
    reason: str,
) -> tuple[str | None, str]:
    bootstrap_claim = _as_non_placeholder_str(config.get("bootstrap_claim"))
    if not bootstrap_claim:
        return None, "Bootstrap claim is missing."

    try:
        refreshed_token = _claim_agent_token_with_bootstrap(config, bootstrap_claim)
    except Exception as exc:
        return None, str(exc)

    if not refreshed_token:
        return None, "Bootstrap claim exchange did not return an agent token."

    config["bootstrap_claim"] = ""
    config["bootstrap_claim_expires_at"] = ""
    log.warning(f"{reason}: exchanged bootstrap claim for agent token.")
    return refreshed_token, ""


def _refresh_agent_token_from_enrollment(
    config: dict[str, Any],
    reason: str,
) -> tuple[str | None, str]:
    enrollment_key = _as_non_placeholder_str(config.get("enrollment_key"))
    if not enrollment_key:
        return None, "Enrollment key is missing."

    try:
        refreshed_token = _enroll_node_with_hub(config, enrollment_key)
    except Exception as exc:
        return None, str(exc)

    if not refreshed_token:
        return None, "Hub enrollment did not return an agent token."

    log.warning(f"{reason}: refreshed agent token from enrollment key.")
    return refreshed_token, ""


def _decommission_node_from_hub(config: dict[str, Any]) -> dict[str, Any]:
    hub_url = _as_str(config.get("hub_url")).rstrip("/")
    node_id = _as_str(config.get("node_id") or config.get("agent_id"))
    token = _as_non_placeholder_str(config.get("agent_token"))
    bootstrap_claim = _as_non_placeholder_str(config.get("bootstrap_claim"))
    enrollment_key = _as_non_placeholder_str(config.get("enrollment_key"))

    if not hub_url:
        return {
            "ok": False,
            "removed_player_ids": [],
            "error": "Hub URL is missing.",
            "status_code": None,
        }

    if not token and bootstrap_claim:
        try:
            token = _claim_agent_token_with_bootstrap(config, bootstrap_claim)
            config["agent_token"] = token
            config["bootstrap_claim"] = ""
            config["bootstrap_claim_expires_at"] = ""
        except Exception as exc:
            return {
                "ok": False,
                "removed_player_ids": [],
                "error": str(exc),
                "status_code": None,
            }

    if not token and not enrollment_key:
        return {
            "ok": False,
            "removed_player_ids": [],
            "error": "Agent token is missing (and no usable bootstrap claim or enrollment key was found).",
            "status_code": None,
        }

    if not node_id and not token:
        return {
            "ok": False,
            "removed_player_ids": [],
            "error": "Node ID is required when agent token is missing.",
            "status_code": None,
        }

    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload: dict[str, Any] = {}
    if node_id:
        payload["nodeId"] = node_id
    if enrollment_key:
        payload["enrollmentKey"] = enrollment_key

    try:
        response = requests.post(
            f"{hub_url}/api/config/node/decommission",
            json=payload,
            headers=headers or None,
            timeout=20,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "removed_player_ids": [],
            "error": str(exc),
            "status_code": None,
        }

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code >= 400:
        error_message = _as_str(body.get("error")) if isinstance(body, dict) else ""
        return {
            "ok": False,
            "removed_player_ids": [],
            "error": error_message or f"HTTP {response.status_code}",
            "status_code": response.status_code,
        }

    removed_player_ids = []
    if isinstance(body, dict) and isinstance(body.get("removedPlayerIds"), list):
        removed_player_ids = [
            _as_str(player_id)
            for player_id in body.get("removedPlayerIds", [])
            if _as_str(player_id)
        ]

    return {
        "ok": True,
        "removed_player_ids": removed_player_ids,
        "error": "",
        "status_code": response.status_code,
    }


def _normalize_log_path_key(log_path: Any) -> str:
    path = _as_str(log_path).strip()
    if not path:
        return ""
    return os.path.normcase(os.path.normpath(path))


def _build_cycle_shared_context(players: list[dict[str, Any]]) -> dict[str, Any]:
    shared_connectivity: dict[str, Any] = {}
    try:
        shared_connectivity = connectivity.check()
    except Exception as e:
        log.debug(f"shared connectivity check error: {e}")

    log_path_counts: dict[str, int] = {}
    for player in players:
        playout_type = _as_str(player.get("playout_type"), DEFAULT_PLAYOUT_TYPE)
        paths = player.get("paths", {}) if isinstance(player.get("paths"), dict) else {}
        log_path = log_monitor.resolve_log_path(playout_type, paths, require_exists=False)
        log_path_key = _normalize_log_path_key(log_path)
        if log_path_key:
            log_path_counts[log_path_key] = log_path_counts.get(log_path_key, 0) + 1

    return {
        "shared_connectivity": shared_connectivity,
        "log_path_counts": log_path_counts,
    }


def _should_allow_unscoped_log_tokens(
    player: dict[str, Any],
    log_path_counts: dict[str, int] | None = None,
) -> bool:
    log_selectors = player.get("log_selectors", {}) if isinstance(player.get("log_selectors"), dict) else {}
    if log_monitor.has_scope_selectors(log_selectors):
        return True

    playout_type = _as_str(player.get("playout_type"), DEFAULT_PLAYOUT_TYPE)
    paths = player.get("paths", {}) if isinstance(player.get("paths"), dict) else {}
    log_path = log_monitor.resolve_log_path(playout_type, paths, require_exists=False)
    log_path_key = _normalize_log_path_key(log_path)
    if not log_path_key:
        return True

    counts = log_path_counts or {}
    return counts.get(log_path_key, 0) <= 1


def poll_player(
    node_id: str,
    hub_url: str,
    token: str,
    player: dict[str, Any],
    node_config_mirror: dict[str, Any] | None = None,
    cycle_context: dict[str, Any] | None = None,
) -> None:
    player_id = player["player_id"]
    playout_type = player.get("playout_type", "insta")
    paths = player.get("paths", {})
    process_selectors = player.get("process_selectors", {})
    log_selectors = player.get("log_selectors", {})
    udp_inputs = player.get("udp_inputs", [])
    cycle_context = cycle_context if isinstance(cycle_context, dict) else {}
    shared_connectivity = cycle_context.get("shared_connectivity")
    log_path_counts = cycle_context.get("log_path_counts", {})

    observations: dict[str, Any] = {}

    # 1. Process and window presence
    try:
        obs = process_monitor.check(player_id, playout_type, process_selectors)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{player_id}] process check error: {e}")

    # 2. Deep log monitoring
    try:
        obs = log_monitor.check(
            player_id,
            playout_type,
            paths,
            log_selectors,
            allow_unscoped_tokens=_should_allow_unscoped_log_tokens(player, log_path_counts),
        )
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
        if isinstance(shared_connectivity, dict) and shared_connectivity:
            observations.update(shared_connectivity)
        else:
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

    effective_node_config_mirror = _current_runtime_node_config_mirror(node_config_mirror)

    # POST heartbeat
    response_payload, response_status = post_heartbeat(
        hub_url,
        token,
        node_id,
        player_id,
        observations,
        node_config_mirror=effective_node_config_mirror,
    )
    if response_status == 401:
        raise HubUnauthorizedError(f"Heartbeat unauthorized for {player_id}")
    if response_payload is not None:
        log.debug(f"[{player_id}] heartbeat OK - {observations}")

    # POST thumbnail if captured
    if primary_udp:
        thumbnail_udp_input_id = primary_udp["udp_input_id"]
        thumbnail_data_url = _maybe_capture_thumbnail(
            node_id,
            player_id,
            thumbnail_udp_input_id,
            primary_udp["stream_url"],
            _as_int(primary_udp.get("thumbnail_interval_s"), 10),
        )

    if thumbnail_data_url and thumbnail_udp_input_id:
        post_thumbnail(hub_url, token, node_id, player_id, thumbnail_udp_input_id, thumbnail_data_url)

    return None


# --- Main loop ----------------------------------------------------------------

def run_agent_loop() -> int:
    config_path = _runtime_config_path()
    last_config_signature = ""
    last_identity_warning_key = ""

    while True:
        config = load_config(config_path)
        _clear_runtime_local_config_override_if_matches(config)
        _start_persistent_local_ui_server()

        node_id = config["node_id"]
        node_name = config["node_name"]
        hub_url = config["hub_url"].rstrip("/")
        poll_interval = int(config.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS))
        players = config.get("players", [])
        token = _as_non_placeholder_str(config.get("agent_token"))
        if not token:
            refreshed_token, refresh_error = _refresh_agent_token_from_bootstrap_claim(
                config,
                "Startup missing agent token",
            )
            if not refreshed_token:
                refreshed_token, refresh_error = _refresh_agent_token_from_enrollment(
                    config,
                    "Startup missing agent token",
                )
            if refreshed_token:
                token = refreshed_token
                config["agent_token"] = refreshed_token
                _write_yaml(config_path, config)
                last_config_signature = ""
                last_identity_warning_key = ""
            else:
                warning_key = f"{node_id}|{hub_url}"
                if warning_key != last_identity_warning_key:
                    log.warning(
                        f"Pulse is running locally for node {node_id}, but hub registration is not active. "
                        f"Open {_local_ui_url()} and import a provisioned setup link/config to connect this node "
                        f"to the hub. ({refresh_error or 'No bootstrap claim or enrollment key found.'})"
                    )
                    last_identity_warning_key = warning_key
                time.sleep(max(3, poll_interval))
                continue
        last_identity_warning_key = ""
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
            try:
                _ensure_ff_tools(required=_config_has_enabled_udp(config))
            except Exception as exc:
                log.error(f"UDP monitoring tools unavailable: {exc}")
            log.info(f"Pulse Agent starting - node_id={node_id}, node_name={node_name}, hub={hub_url}")
            log.info(f"Monitoring {len(players)} player(s): {[p['player_id'] for p in players]}")
            last_config_signature = config_signature

        cycle_start = time.time()
        cycle_context = _build_cycle_shared_context(players)
        refreshed_token_this_cycle = False

        for player in players:
            player_id = _as_str(player.get("player_id"))
            if player_id and _player_is_runtime_suppressed(player_id):
                continue
            try:
                poll_player(
                    node_id,
                    hub_url,
                    token,
                    player,
                    node_config_mirror=node_config_mirror,
                    cycle_context=cycle_context,
                )
            except HubUnauthorizedError as exc:
                refreshed_token, refresh_error = _refresh_agent_token_from_bootstrap_claim(
                    config,
                    "Heartbeat unauthorized",
                )
                if not refreshed_token:
                    refreshed_token, refresh_error = _refresh_agent_token_from_enrollment(
                        config,
                        "Heartbeat unauthorized",
                    )
                if refreshed_token:
                    config["agent_token"] = refreshed_token
                    _write_yaml(config_path, config)
                    log.warning(
                        f"{exc}. Refreshed agent token; restarting polling cycle."
                    )
                    refreshed_token_this_cycle = True
                    last_config_signature = ""
                    break
                log.error(f"{exc}. Token refresh failed: {refresh_error or 'No bootstrap claim or enrollment key found.'}")
            except Exception:
                log.error(f"Unhandled error polling {player.get('player_id', '?')}:\n{traceback.format_exc()}")

        if refreshed_token_this_cycle:
            continue

        elapsed = time.time() - cycle_start
        sleep_time = max(0, poll_interval - elapsed)
        time.sleep(sleep_time)

    return 0


def main() -> int:
    args = sys.argv[1:]
    if args:
        command = args[0]
        if command == "--score-discovery":
            input_path = args[1] if len(args) > 1 and not args[1].startswith("--") else None
            db_path = _command_option_value(args[1:], "--db-path")
            return score_discovery_command(input_path, db_path)
        if command == "--validate-config":
            config_path = args[1] if len(args) > 1 else None
            return validate_config_command(config_path)
        if command == "--install-service":
            return install_service_command()
        if command == "--install-service-admin":
            return install_service_admin_command()
        if command == "--configure":
            return configure_command()
        if command == "--configure-bundle":
            import_path = args[1] if len(args) > 1 else None
            return configure_bundle_command(import_path)
        if command == "--open-local-ui":
            return open_local_ui_command()
        if command == "--uninstall-service":
            return uninstall_service_command()
        if command == "--decommission-hub":
            return decommission_hub_command()
        if command == "--service-loop":
            return run_agent_loop()

    if _is_interactive_session():
        return interactive_entrypoint()

    return run_agent_loop()


if __name__ == "__main__":
    sys.exit(main())
