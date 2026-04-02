import React, { useEffect, useState } from 'react';

interface UdpInputConfig {
  udpInputId: string;
  enabled: boolean;
  streamUrl: string;
}

interface PlayerConfigPayload {
  udpInputs: UdpInputConfig[];
}

interface Props {
  playerId: string;
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

  return (
    <div className="mt-4 rounded-2xl border border-slate-800/90 bg-slate-950/45 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Node Mirror</p>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
          }}
          className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          {open ? 'Hide mirror' : 'Local mirror'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-3 text-sm text-slate-300">
            Stream URLs mirrored from the node. Edit on the node&apos;s local Pulse UI.
          </p>

          {loading && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
              Loading...
            </div>
          )}

          {!loading && udpInputs.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-3 py-4 text-sm text-slate-400">
              No streams configured on this node.
            </div>
          )}

          {!loading && udpInputs.length > 0 && (
            <div className="space-y-2">
              {udpInputs.map((entry, index) => (
                <div key={entry.udpInputId} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Stream {index + 1}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${entry.enabled ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
                      {entry.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="mt-2 break-all rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-100">
                    {entry.streamUrl || <span className="text-slate-500 italic">not set</span>}
                  </p>
                </div>
              ))}
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
