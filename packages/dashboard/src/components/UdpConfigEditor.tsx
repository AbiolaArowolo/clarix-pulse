import React, { useEffect, useState } from 'react';

interface UdpInputConfig {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
  thumbnailIntervalS: number;
}

interface PlayerConfigPayload {
  playerId: string;
  nodeId: string;
  udpInputs: UdpInputConfig[];
  updatedAt: string | null;
}

interface Props {
  playerId: string;
}

const CONFIG_WRITE_KEY_STORAGE = 'pulse.config_write_key';

function readStoredKey(): string {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(CONFIG_WRITE_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function storeKey(value: string) {
  if (typeof window === 'undefined') return;

  try {
    if (value) {
      window.localStorage.setItem(CONFIG_WRITE_KEY_STORAGE, value);
    } else {
      window.localStorage.removeItem(CONFIG_WRITE_KEY_STORAGE);
    }
  } catch {
    // Ignore storage failures.
  }
}

function ensureFiveInputs(playerId: string, udpInputs: UdpInputConfig[]): UdpInputConfig[] {
  const next = [...udpInputs];
  while (next.length < 5) {
    next.push({
      udpInputId: `${playerId}-udp-${next.length + 1}`,
      enabled: false,
      streamUrl: '',
      thumbnailIntervalS: 10,
    });
  }
  return next.slice(0, 5);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return 'never';

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function UdpConfigEditor({ playerId }: Props) {
  const [open, setOpen] = useState(false);
  const [writeKey, setWriteKey] = useState(() => readStoredKey());
  const [draft, setDraft] = useState<UdpInputConfig[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadConfig = async () => {
    if (!writeKey.trim()) {
      setError('Enter the config write key to load UDP settings.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/config/player/${playerId}`, {
        headers: {
          'x-config-write-key': writeKey.trim(),
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to load UDP settings.'));
      }

      const config = payload as PlayerConfigPayload;
      setDraft(ensureFiveInputs(playerId, config.udpInputs ?? []));
      setUpdatedAt(config.updatedAt ?? null);
      storeKey(writeKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load UDP settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || draft.length > 0 || !writeKey.trim()) return;
    void loadConfig();
  }, [draft.length, open, playerId, writeKey]);

  const updateInput = (index: number, patch: Partial<UdpInputConfig>) => {
    setDraft((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    )));
  };

  const saveConfig = async () => {
    if (!writeKey.trim()) {
      setError('Enter the config write key before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/config/player/${playerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-config-write-key': writeKey.trim(),
        },
        body: JSON.stringify({
          udpInputs: draft,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to save UDP settings.'));
      }

      const config = payload?.player as PlayerConfigPayload | undefined;
      setDraft(ensureFiveInputs(playerId, config?.udpInputs ?? draft));
      setUpdatedAt(config?.updatedAt ?? new Date().toISOString());
      setNotice('Saved. The node will apply this on its next heartbeat cycle.');
      storeKey(writeKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save UDP settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-800/90 bg-slate-950/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">UDP Settings</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Canonical node config. Last saved: <span className="text-slate-400">{formatUpdatedAt(updatedAt)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
            setNotice(null);
          }}
          className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          {open ? 'Hide settings' : 'UDP settings'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="password"
              value={writeKey}
              onChange={(event) => setWriteKey(event.target.value)}
              placeholder="Config write key"
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
            />
            <button
              type="button"
              onClick={() => void loadConfig()}
              disabled={loading}
              className="rounded-xl border border-teal-600/50 bg-teal-700/20 px-3 py-2 text-sm font-medium text-teal-100 transition-colors hover:border-teal-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Load'}
            </button>
          </div>

          {draft.length > 0 && (
            <div className="space-y-3">
              {draft.map((entry, index) => (
                <div key={entry.udpInputId} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-300">{entry.udpInputId}</p>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={(event) => updateInput(index, { enabled: event.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>

                  <div className="mt-3 grid gap-2">
                    <input
                      type="text"
                      value={entry.streamUrl}
                      onChange={(event) => updateInput(index, { streamUrl: event.target.value })}
                      placeholder="udp://239.0.0.1:5000"
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                    />
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={entry.thumbnailIntervalS}
                      onChange={(event) => updateInput(index, { thumbnailIntervalS: Number(event.target.value) || 10 })}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => void saveConfig()}
                disabled={saving}
                className="w-full rounded-xl border border-yellow-600/60 bg-yellow-500/15 px-4 py-2 text-sm font-semibold text-yellow-100 transition-colors hover:border-yellow-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save UDP settings'}
              </button>
            </div>
          )}

          {notice && (
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
