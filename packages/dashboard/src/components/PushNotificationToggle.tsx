import React, { useEffect, useState } from 'react';

type PushStatus = 'checking' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) return null;
    const data = await res.json() as { publicKey?: string };
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function PushNotificationToggle() {
  const [status, setStatus] = useState<PushStatus>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }

    getCurrentSubscription()
      .then((sub) => setStatus(sub ? 'subscribed' : 'unsubscribed'))
      .catch(() => setStatus('unsubscribed'));
  }, []);

  const subscribe = async () => {
    setBusy(true);
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return;
      }

      const vapidKey = await getVapidPublicKey();
      if (!vapidKey) throw new Error('Push notifications are not configured on this server.');

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to save subscription.');
      }

      setStatus('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setError(null);

    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus('unsubscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable notifications.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'checking') return null;
  if (status === 'unsupported') return null;

  return (
    <div className="mt-5 rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">Alert notifications</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {status === 'denied'
              ? 'Blocked by your browser. Enable notifications in browser settings to use this feature.'
              : status === 'subscribed'
                ? 'You will receive push alerts on this device even when the app is closed.'
                : 'Get push alerts on this device when a player goes off-air.'}
          </p>
        </div>

        {status !== 'denied' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void (status === 'subscribed' ? unsubscribe() : subscribe())}
            className={`shrink-0 rounded-[var(--radius-control)] border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              status === 'subscribed'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400'
                : 'border-indigo-400/35 bg-indigo-400/14 text-indigo-50 hover:border-indigo-300'
            }`}
          >
            {busy ? '...' : status === 'subscribed' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}
