import React, { useEffect, useState } from 'react';
import { LOGIN_ROTATOR } from '../content/publicExperience';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

function formatAccessKeyInput(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

export function LoginPage({
  loading,
  error,
  notice,
  registration,
  onLogin,
  onNavigate,
}: {
  loading: boolean;
  error: string | null;
  notice: string | null;
  registration: {
    accessKey?: string | null;
    accessKeyExpiresAt?: string | null;
    pendingActivation?: boolean;
    emailSent?: boolean;
  } | null;
  onLogin: (input: { email: string; password: string; accessKey: string }) => Promise<void>;
  onNavigate: (pathname: string) => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setMessageIndex((value) => (value + 1) % LOGIN_ROTATOR.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_28%),radial-gradient(circle_at_88%_12%,rgba(34,197,94,0.12),transparent_20%),linear-gradient(180deg,#03111f_0%,#071b2b_56%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="rounded-[32px] border border-cyan-500/15 bg-slate-950/45 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Welcome back</p>
                <h1 className="mt-4 text-3xl font-semibold text-white">Reconnect with the live picture in seconds</h1>
              </div>
              <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                Workspace access
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Sign in to continue monitoring current activity, review what changed, and keep your team working from the same operational timeline.
            </p>

            <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/62 p-5">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Live focus</p>
              <p className="mt-3 min-h-[3.5rem] text-lg leading-8 text-slate-100">
                {LOGIN_ROTATOR[messageIndex]}
              </p>
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onLogin({ email, password, accessKey });
            }}
            className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Sign in</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm text-slate-300">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-sm text-slate-300">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-sm text-slate-300">
                  Access key{' '}
                  <span className="text-xs font-normal text-slate-500">(required only while pending activation)</span>
                </span>
                <input
                  type="text"
                  value={accessKey}
                  onChange={(event) => setAccessKey(formatAccessKeyInput(event.target.value))}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm uppercase tracking-[0.18em] text-slate-100 outline-none focus:border-cyan-400"
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Leave blank — your account is active and only email + password are needed.
                  Your access key was sent to your registration email as a recovery credential.
                  You can request a new one from Account settings at any time.
                </p>
              </label>
            </div>

            {notice && (
              <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {notice}
              </div>
            )}

            {registration?.accessKey && (
              <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
                <p className="font-semibold">Access key fallback</p>
                <p className="mt-2 leading-6">
                  Email delivery was unavailable for this registration, so this key is shown once here. Keep it safe.
                </p>
                <div className="mt-3 rounded-2xl border border-amber-300/15 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
                  {registration.accessKey}
                </div>
                <p className="mt-3 text-xs text-amber-100/80">
                  Expires: {registration.accessKeyExpiresAt ?? '365 days from issue'}
                  {registration.pendingActivation ? ' | Account still pending activation.' : ''}
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/forgot-password')}
              className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Forgot password
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/register')}
              className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Create a new account
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
