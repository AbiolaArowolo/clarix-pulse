import React, { useState } from 'react';
import { SignUp, useAuth as useClerkAuth } from '@clerk/clerk-react';
import { useAuth } from '../features/auth/AuthProvider';
import { clerkAppearance } from '../lib/clerkAppearance';

// LEARN: this page now covers two steps that used to be one form submit.
// 1. Prove who you are - handled entirely by Clerk's <SignUp/> widget
//    (email/password, verification, etc.). No Pulse involvement yet.
// 2. Create a workspace - once Clerk confirms an identity that has no Pulse
//    tenant linked to it yet, POST /api/auth/register spins up a brand-new
//    tenant + owner user for that identity (companyName/displayName only -
//    no password, no access key). This is still the ONE self-service path
//    Pulse keeps; adding a person to an *existing* tenant stays admin-only.
// App.tsx routes anyone who is Clerk-signed-in but not yet Pulse-authenticated
// to this page, so step 2 below is also where a returning "not linked yet"
// visitor lands.
export function RegisterPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const clerkAuth = useClerkAuth();
  const auth = useAuth();
  const [companyName, setCompanyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // Clerk has already confirmed identity, and Pulse has confirmed (via
  // auth.bootstrapped's session fetch) that no tenant is linked to it -
  // time to show the workspace-creation form instead of the sign-up widget.
  const readyToCreateWorkspace = clerkAuth.isLoaded && clerkAuth.isSignedIn === true
    && auth.bootstrapped && !auth.authenticated;

  const submitWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyName.trim()) {
      setLocalError('Company name is required.');
      return;
    }
    setLocalError(null);
    await auth.register({ companyName, displayName });
  };

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="theme-gradient-overlay pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_26%),radial-gradient(circle_at_80%_10%,rgba(249,115,22,0.16),transparent_18%),linear-gradient(180deg,#03111f_0%,#071b2b_58%,#0b1322_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section className="rounded-[32px] border border-amber-400/15 bg-slate-950/48 p-8 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            {readyToCreateWorkspace ? (
              <>
                <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300">Almost there</p>
                <h1 className="mt-4 text-3xl font-semibold text-white">Name the workspace your team will monitor from</h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  You're signed in - Clarix Pulse just needs a company name to finish setting up your workspace. Your sign-in email becomes the first alert contact until you change it later.
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300">Start your workspace</p>
                <h1 className="mt-4 text-3xl font-semibold text-white">Create a live operations view your team can trust</h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  Clarix Pulse is built for teams that need earlier warning, faster verification, and a cleaner response path when critical work starts drifting away from normal.
                </p>
              </>
            )}

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
                  Adding teammates to an existing workspace is handled by your Clarix Pulse administrator.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                <p className="text-sm font-semibold text-white">Deploy at your pace</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Installer downloads, discovery, and provisioning happen after the account is ready to go live.
                </p>
              </div>
            </div>

            {!readyToCreateWorkspace && (
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="mt-6 text-sm font-medium text-slate-400 transition-colors hover:text-slate-200"
              >
                Already have a workspace? Sign in
              </button>
            )}
          </section>

          <div className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            {readyToCreateWorkspace ? (
              <>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Create workspace</p>
                <form onSubmit={submitWorkspace} className="mt-5 space-y-4">
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

                  {(localError || auth.error) && (
                    <div className="rounded-2xl border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                      {localError ?? auth.error}
                    </div>
                  )}

                  {auth.notice && (
                    <div className="rounded-2xl border border-emerald-700/40 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-100">
                      {auth.notice}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={auth.loading}
                    className="w-full rounded-2xl border border-cyan-400/35 bg-cyan-400/12 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {auth.loading ? 'Creating workspace...' : 'Create workspace'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => void auth.logout()}
                  className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Not you? Sign out
                </button>
              </>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Create sign-in</p>
                <div className="mt-5">
                  <SignUp
                    routing="virtual"
                    signInUrl="/login"
                    fallbackRedirectUrl="/register"
                    appearance={clerkAppearance}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
