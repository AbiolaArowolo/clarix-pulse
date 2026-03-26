import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'clarix.db');

// Create libsql client pointing to a local SQLite file
export const db: Client = createClient({ url: `file:${DB_PATH}` });

export async function initDb(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS instance_state (
      instance_id         TEXT PRIMARY KEY,
      agent_id            TEXT NOT NULL,
      broadcast_health    TEXT NOT NULL DEFAULT 'unknown',
      runtime_health      TEXT NOT NULL DEFAULT 'unknown',
      connectivity_health TEXT NOT NULL DEFAULT 'offline',
      last_heartbeat_at   TEXT,
      last_observations   TEXT,
      thumbnail_data      TEXT,
      thumbnail_at        TEXT,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id    TEXT NOT NULL,
      event_type     TEXT NOT NULL,
      from_state     TEXT,
      to_state       TEXT,
      observations   TEXT,
      alert_sent     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_instance_id ON events(instance_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `);
}

export type BroadcastHealth = 'healthy' | 'degraded' | 'off_air_likely' | 'off_air_confirmed' | 'unknown';
export type RuntimeHealth = 'healthy' | 'paused' | 'restarting' | 'stalled' | 'stopped' | 'content_error' | 'unknown';
export type ConnectivityHealth = 'online' | 'stale' | 'offline';

export interface HealthState {
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
}

export interface InstanceState {
  instanceId: string;
  agentId: string;
  broadcastHealth: BroadcastHealth;
  runtimeHealth: RuntimeHealth;
  connectivityHealth: ConnectivityHealth;
  lastHeartbeatAt: string | null;
  lastObservations: Record<string, unknown> | null;
  thumbnailData: string | null; // base64 stored as TEXT in libsql
  thumbnailAt: string | null;
  updatedAt: string;
}
