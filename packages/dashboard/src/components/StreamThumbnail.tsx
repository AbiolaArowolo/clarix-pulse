import React, { useEffect, useState } from 'react';

interface Props {
  playerId: string;
  available: boolean;
  dataUrl: string | undefined;
  capturedAt: string | null;
  instanceLabel: string;
}

export function StreamThumbnail({ playerId, available, dataUrl, capturedAt, instanceLabel }: Props) {
  const [resolvedDataUrl, setResolvedDataUrl] = useState(dataUrl);

  useEffect(() => {
    setResolvedDataUrl(dataUrl);
  }, [dataUrl]);

  useEffect(() => {
    if (!available || resolvedDataUrl) {
      return;
    }

    let cancelled = false;
    fetch(`/api/thumbnail/${encodeURIComponent(playerId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Thumbnail not available');
        }
        return response.json() as Promise<{ dataUrl?: string }>;
      })
      .then((payload) => {
        if (!cancelled && payload.dataUrl) {
          setResolvedDataUrl(payload.dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedDataUrl(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [available, playerId, resolvedDataUrl]);

  if (!available) {
    return (
      <div className="mt-3 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center h-28 text-slate-500 text-xs">
        No stream snapshot
      </div>
    );
  }

  if (!resolvedDataUrl) {
    return (
      <div className="mt-3 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center h-28 text-slate-500 text-xs">
        Loading stream snapshot...
      </div>
    );
  }

  const age = capturedAt
    ? Math.round((Date.now() - new Date(capturedAt).getTime()) / 1000)
    : null;

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-slate-700 relative">
      <img
        src={resolvedDataUrl}
        alt={`Stream snapshot - ${instanceLabel}`}
        className="w-full object-cover max-h-36"
      />
      {age !== null && (
        <div className="absolute bottom-0 right-0 bg-black/70 text-slate-300 text-xs px-2 py-0.5 rounded-tl">
          {age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}
        </div>
      )}
    </div>
  );
}
