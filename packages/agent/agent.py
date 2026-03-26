"""
Clarix Pulse — Local Monitoring Agent
Runs as a Windows Service via NSSM. Polls every N seconds, POSTs one heartbeat
per playout instance to the hub. Sends raw observations only — hub computes health state.
"""

import os
import sys
import time
import logging
import traceback
from datetime import datetime
from typing import Any

import yaml
import requests

from monitors import process_monitor, log_monitor, file_monitor, connectivity, udp_probe

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("clarix-agent.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("clarix-agent")

# ─── Config ───────────────────────────────────────────────────────────────────

def load_config() -> dict:
    config_path = os.path.join(os.path.dirname(sys.executable if getattr(sys, "frozen", False) else __file__), "config.yaml")
    if not os.path.exists(config_path):
        log.error(f"config.yaml not found at {config_path}")
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ─── Heartbeat ────────────────────────────────────────────────────────────────

def post_heartbeat(hub_url: str, token: str, agent_id: str, instance_id: str, observations: dict) -> bool:
    url = f"{hub_url}/api/heartbeat"
    payload = {
        "agentId": agent_id,
        "instanceId": instance_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "observations": observations,
    }
    try:
        r = requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if r.status_code == 200:
            return True
        log.warning(f"Heartbeat rejected for {instance_id}: {r.status_code} {r.text[:200]}")
        return False
    except requests.RequestException as e:
        log.warning(f"Heartbeat POST failed for {instance_id}: {e}")
        return False


def post_thumbnail(hub_url: str, token: str, agent_id: str, instance_id: str, data_url: str) -> None:
    url = f"{hub_url}/api/thumbnail"
    payload = {
        "agentId": agent_id,
        "instanceId": instance_id,
        "dataUrl": data_url,
        "capturedAt": datetime.utcnow().isoformat() + "Z",
    }
    try:
        requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except requests.RequestException as e:
        log.debug(f"Thumbnail POST failed for {instance_id}: {e}")


# ─── Per-instance poll ────────────────────────────────────────────────────────

# Track thumbnail intervals
_last_thumbnail_at: dict[str, float] = {}


def poll_instance(agent_id: str, hub_url: str, token: str, inst: dict) -> None:
    instance_id = inst["id"]
    playout_type = inst.get("playout_type", "insta")
    paths = inst.get("paths", {})
    udp_cfg = inst.get("udp_probe", {})
    udp_enabled = udp_cfg.get("enabled", False)
    stream_url = udp_cfg.get("stream_url", "")
    thumbnail_interval = udp_cfg.get("thumbnail_interval_s", 10)

    observations: dict[str, Any] = {}

    # 1. Process and window presence
    try:
        obs = process_monitor.check(instance_id, playout_type)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{instance_id}] process check error: {e}")

    # 2. Deep log monitoring
    try:
        obs = log_monitor.check(instance_id, playout_type, paths)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{instance_id}] log monitor error: {e}")

    # 3. File state (stall detection + content errors)
    try:
        obs = file_monitor.check(instance_id, playout_type, paths)
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{instance_id}] file monitor error: {e}")

    # 4. Connectivity
    try:
        obs = connectivity.check()
        observations.update(obs)
    except Exception as e:
        log.debug(f"[{instance_id}] connectivity check error: {e}")

    # 5. UDP probe (only if enabled and stream URL configured)
    thumbnail_data_url = None
    if udp_enabled and stream_url:
        try:
            obs = udp_probe.check(stream_url)
            observations.update(obs)
        except Exception as e:
            log.debug(f"[{instance_id}] UDP probe error: {e}")

        # Thumbnail capture (rate-limited by thumbnail_interval)
        now = time.time()
        last_thumb = _last_thumbnail_at.get(instance_id, 0)
        if now - last_thumb >= thumbnail_interval:
            try:
                thumbnail_data_url = udp_probe.capture_thumbnail(stream_url)
                _last_thumbnail_at[instance_id] = now
            except Exception as e:
                log.debug(f"[{instance_id}] thumbnail capture error: {e}")

    # POST heartbeat
    success = post_heartbeat(hub_url, token, agent_id, instance_id, observations)
    if success:
        log.debug(f"[{instance_id}] heartbeat OK — {observations}")

    # POST thumbnail if captured
    if thumbnail_data_url:
        post_thumbnail(hub_url, token, agent_id, instance_id, thumbnail_data_url)


# ─── Main loop ────────────────────────────────────────────────────────────────

def main() -> None:
    config = load_config()

    agent_id = config["agent_id"]
    hub_url = config["hub_url"].rstrip("/")
    token = config["agent_token"]
    poll_interval = int(config.get("poll_interval_seconds", 10))
    instances = config.get("instances", [])

    log.info(f"Clarix Pulse Agent starting — agent_id={agent_id}, hub={hub_url}")
    log.info(f"Monitoring {len(instances)} instance(s): {[i['id'] for i in instances]}")

    while True:
        cycle_start = time.time()

        for inst in instances:
            try:
                poll_instance(agent_id, hub_url, token, inst)
            except Exception:
                log.error(f"Unhandled error polling {inst.get('id', '?')}:\n{traceback.format_exc()}")

        elapsed = time.time() - cycle_start
        sleep_time = max(0, poll_interval - elapsed)
        time.sleep(sleep_time)


if __name__ == "__main__":
    main()
