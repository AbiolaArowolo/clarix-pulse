import React, { useEffect, useState } from 'react';
import { SignIn } from '@clerk/clerk-react';
import { LOGIN_ROTATOR } from '../content/publicExperience';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { clerkAppearance } from '../lib/clerkAppearance';

// LEARN: identity now lives entirely inside Clerk's <SignIn/> widget - it
// handles the email/password fields, "forgot password" recovery, and the
// link over to sign-up on its own. This page just supplies the surrounding
// marketing panel and points the widget at our own /register route (via
// signUpUrl) so it stays inside the app's own routing instead of Clerk's.
export function LoginPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
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
      <div className="theme-gradient-overlay pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_28%),radial-gradient(circle_at_88%_12%,rgba(34,197,94,0.12),transparent_20%),linear-gradient(180deg,#03111f_0%,#071b2b_56%,#0b1322_100%)]" />

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

            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="mt-6 text-sm font-medium text-slate-400 transition-colors hover:text-slate-200"
            >
              Back to overview
            </button>
          </section>

          <div className="rounded-[32px] border border-slate-800 bg-slate-950/72 p-6 shadow-[0_24px_90px_rgba(2,12,27,0.42)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Sign in</p>
            <div className="mt-5">
              <SignIn
                routing="virtual"
                signUpUrl="/register"
                fallbackRedirectUrl="/app"
                appearance={clerkAppearance}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
