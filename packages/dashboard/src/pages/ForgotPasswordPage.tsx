import React, { useState } from 'react';
import { useAuth } from '../features/auth/AuthProvider';

export function ForgotPasswordPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const auth = useAuth();
  const [email, setEmail] = useState('');

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_80%_10%,rgba(14,165,233,0.14),transparent_18%),linear-gradient(180deg,#03111f_0%,#071b2b_58%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-[32px] border border-cyan-500/15 bg-slate-950/45 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Account recovery</p>
            <h1 className="mt-4 text-3xl font-semibold text-white">Reset access without opening a support ticket</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Enter the email for the account you want to recover. If it exists, Clarix Pulse will send a reset link.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">What changes</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  The reset replaces the password only. Tenant access keys and node configuration stay unchanged.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">If email is unavailable</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  A platform admin can issue a reset link from the admin console and deliver it manually.
                </p>
              </div>
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void auth.requestPasswordReset(email);
            }}
            className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Request reset link</p>

            <label className="mt-5 block">
              <span className="text-sm text-slate-300">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              The response is intentionally generic and does not confirm whether the email is registered.
            </p>

            {auth.notice && (
              <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {auth.notice}
              </div>
            )}

            {auth.error && (
              <div className="mt-4 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {auth.error}
              </div>
            )}

            <button
              type="submit"
              disabled={auth.loading}
              className="mt-5 w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auth.loading ? 'Sending reset link...' : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
