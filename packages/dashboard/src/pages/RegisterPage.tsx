import React, { useState } from 'react';

export function RegisterPage({
  loading,
  error,
  notice,
  registration,
  onRegister,
  onNavigate,
}: {
  loading: boolean;
  error: string | null;
  notice: string | null;
  registration: {
    email?: string;
    accessKey?: string | null;
    accessKeyExpiresAt?: string | null;
    pendingActivation?: boolean;
    emailSent?: boolean;
  } | null;
  onRegister: (input: {
    companyName: string;
    displayName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  onNavigate: (pathname: string) => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="theme-gradient-overlay pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_80%_10%,rgba(249,115,22,0.16),transparent_18%),linear-gradient(180deg,#03111f_0%,#071b2b_58%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section className="rounded-[32px] border border-amber-400/15 bg-slate-950/48 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300">Start your workspace</p>
            <h1 className="mt-4 text-3xl font-semibold text-white">Create a live operations view your team can trust</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Clarix Pulse is built for teams that need earlier warning, faster verification, and a cleaner response path when critical work starts drifting away from normal.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">Detect sooner</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Bring live activity, logs, and continuity checks into one operational picture.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">Start with the right people</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The registration email becomes the first alert contact until you change it later.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">Deploy at your pace</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Installer downloads, discovery, and provisioning happen after the account is ready to go live.
                </p>
              </div>
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onRegister({ companyName, displayName, email, password });
            }}
            className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Registration</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm text-slate-300">Company name</span>
                <input
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-sm text-slate-300">Your name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>

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
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              A 365-day access key is created during registration. If email delivery is unavailable, Clarix Pulse will show the key once on screen so you can keep moving.
            </p>

            {notice && (
              <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {notice}
              </div>
            )}

            {registration?.accessKey && (
              <div className="mt-4 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
                <p className="font-semibold">Access key fallback</p>
                <p className="mt-2 leading-6">
                  Email delivery was unavailable, so the access key for <span className="font-semibold">{registration.email ?? 'this account'}</span> is shown once here.
                </p>
                <div className="mt-3 rounded-2xl border border-amber-300/15 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
                  {registration.accessKey}
                </div>
                <p className="mt-3 text-xs text-amber-100/80">
                  Expires: {registration.accessKeyExpiresAt ?? '365 days from issue'}
                  {registration.pendingActivation ? ' | Account pending activation.' : ''}
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
              {loading ? 'Creating account...' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Already registered? Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
