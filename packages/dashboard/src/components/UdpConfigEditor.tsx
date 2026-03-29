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
  playoutType: string;
  paths: Record<string, unknown>;
  processSelectors: Record<string, unknown>;
  logSelectors: Record<string, unknown>;
  udpInputs: UdpInputConfig[];
  updatedAt: string | null;
  source?: 'node' | 'hub';
}

interface Props {
  playerId: string;
}

function renderSelectorValue(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    return parts.length > 0 ? parts.join(', ') : 'Not set';
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return 'Not set';
}

function selectorEntries(selectors: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(selectors).filter(([, value]) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function UdpConfigEditor({ playerId }: Props) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<PlayerConfigPayload | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/config/player/${playerId}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to load stream settings.'));
      }

      setConfig(payload as PlayerConfigPayload);
      setLoadedOnce(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stream settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || loadedOnce || loading) return;
    void loadConfig();
  }, [loadedOnce, loading, open, playerId]);

  const udpInputs = config?.udpInputs ?? [];
  const processSelectors = selectorEntries(config?.processSelectors ?? {});
  const logSelectors = selectorEntries(config?.logSelectors ?? {});

  return (
    <div className="mt-4 rounded-2xl border border-slate-800/90 bg-slate-950/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Node Mirror</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
          }}
          className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          {open ? 'Hide mirror' : 'Local mirror'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-3 text-sm text-slate-300">
            The hub mirrors this player&apos;s live node settings for visibility only. Edit them on the node&apos;s local Pulse UI.
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
              Loading mirrored settings...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Playout Type</p>
                    <p className="mt-1 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                      {config?.playoutType ?? 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Mirror Source</p>
                    <p className="mt-1 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                      {config?.source === 'node' ? 'Node local UI' : 'Hub registry'}
                    </p>
                  </div>
                </div>
              </div>

              {Object.keys(config?.paths ?? {}).length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-xs font-medium text-slate-300">Resolved Paths</p>
                  <div className="mt-3 grid gap-3">
                    {Object.entries(config?.paths ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{key}</p>
                        <p className="mt-1 break-all rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                          {renderSelectorValue(value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(processSelectors.length > 0 || logSelectors.length > 0) && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-xs font-medium text-slate-300">Advanced Selectors</p>

                  {processSelectors.length > 0 && (
                    <div className="mt-3 grid gap-3">
                      {processSelectors.map(([key, value]) => (
                        <div key={`process-${key}`}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Process: {key}</p>
                          <p className="mt-1 break-all rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                            {renderSelectorValue(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {logSelectors.length > 0 && (
                    <div className="mt-3 grid gap-3">
                      {logSelectors.map(([key, value]) => (
                        <div key={`log-${key}`}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Log: {key}</p>
                          <p className="mt-1 break-all rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                            {renderSelectorValue(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <p className="text-xs font-medium text-slate-300">Stream Inputs</p>

                {udpInputs.length === 0 && (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-3 py-4 text-sm text-slate-400">
                    No streams are configured on this node right now.
                  </div>
                )}

                {udpInputs.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {udpInputs.map((entry, index) => (
                      <div key={entry.udpInputId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-slate-300">Stream {index + 1}</p>
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${entry.enabled ? 'border-emerald-500/40 text-emerald-200' : 'border-slate-700 text-slate-400'}`}>
                            {entry.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Stream URL</p>
                            <p className="mt-1 break-all rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                              {entry.streamUrl || 'Not set'}
                            </p>
                          </div>

                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Thumbnail Interval</p>
                            <p className="mt-1 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                              {entry.thumbnailIntervalS}s
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
