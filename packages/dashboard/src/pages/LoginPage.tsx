import React, { useState } from 'react';

export function LoginPage({
  loading,
  error,
  onLogin,
  onNavigate,
}: {
  loading: boolean;
  error: string | null;
  onLogin: (input: { email: string; password: string }) => Promise<void>;
  onNavigate: (pathname: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_26%),linear-gradient(180deg,#020617_0%,#0f172a_60%,#111827_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-[32px] border border-slate-800 bg-slate-900/55 p-8 shadow-[0_24px_90px_rgba(2,6,23,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Welcome back</p>
            <h1 className="mt-4 text-3xl font-semibold text-white">Sign in to your Clarix Pulse hub</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Your company dashboard, node inventory, and off-air alert settings stay scoped to this account.
            </p>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onLogin({ email, password });
            }}
            className="rounded-[32px] border border-slate-800 bg-slate-900/70 p-6 shadow-[0_24px_90px_rgba(2,6,23,0.42)] backdrop-blur"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Sign in</p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm text-slate-300">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>

              <label className="block">
                <span className="text-sm text-slate-300">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
            </div>

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
              onClick={() => onNavigate('/register')}
              className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Create a new company hub
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
