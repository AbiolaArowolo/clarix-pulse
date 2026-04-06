import React, { useMemo, useState } from 'react';
import { useAuth } from '../features/auth/AuthProvider';

function initialTokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

export function ResetPasswordPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const auth = useAuth();
  const [token, setToken] = useState(initialTokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const tokenPresent = useMemo(() => token.trim().length > 0, [token]);

  const submit = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setLocalError('Reset token is required.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    setLocalError(null);
    const ok = await auth.resetPassword({ token: trimmedToken, password });
    if (ok) {
      onNavigate('/login');
    }
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="theme-gradient-overlay pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.16),transparent_24%),radial-gradient(circle_at_84%_12%,rgba(20,184,166,0.14),transparent_20%),linear-gradient(180deg,#03111f_0%,#071b2b_58%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="rounded-[32px] border border-amber-400/15 bg-slate-950/48 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300">Reset password</p>
            <h1 className="mt-4 text-3xl font-semibold text-white">Create a new sign-in password</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Use the link from the recovery email, or paste the reset token here if a platform admin sent it to you directly.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">What stays the same</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Your tenant, access key, installer links, and node setup do not change when the password is reset.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">What happens next</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Existing browser sessions for this user are signed out so the new password takes effect cleanly.
                </p>
              </div>
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Reset token</p>

            <label className="mt-5 block">
              <span className="text-sm text-slate-300">Token</span>
              <textarea
                value={token}
                onChange={(event) => setToken(event.target.value)}
                rows={3}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>

            {tokenPresent && (
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Token loaded. Set a new password below.
              </p>
            )}

            <label className="mt-4 block">
              <span className="text-sm text-slate-300">New password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-sm text-slate-300">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>

            {(localError || auth.error) && (
              <div className="mt-4 rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                {localError ?? auth.error}
              </div>
            )}

            {auth.notice && (
              <div className="mt-4 rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                {auth.notice}
              </div>
            )}

            <button
              type="submit"
              disabled={auth.loading}
              className="mt-5 w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auth.loading ? 'Updating password...' : 'Update password'}
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
