import React from 'react';

export function LandingPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(245,158,11,0.14),transparent_20%),linear-gradient(180deg,#020617_0%,#082032_52%,#111827_100%)]" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-blue-400/20 bg-[#071538] shadow-[0_16px_34px_rgba(7,21,56,0.52)]">
            <img src="/pulse.svg" alt="Pulse logo" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Clarix Pulse</p>
            <p className="text-sm text-slate-400">Broadcast monitoring for distributed playout operations</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="rounded-full border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/register')}
            className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
          >
            Create account
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:pt-16">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.28em] text-amber-300">Tenant-isolated monitoring</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Every client gets a private hub, while every node stays easy to discover, provision, and monitor.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              Clarix Pulse gives each company its own dashboard, alerting profile, node inventory, and live off-air view.
              Register once, run discovery on a Windows node, and let the hub mirror the setup into the right account.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('/register')}
                className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-5 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
              >
                Create your company hub
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="rounded-full border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                Sign in to an existing hub
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-cyan-500/20 bg-slate-900/65 p-5 shadow-[0_28px_80px_rgba(2,6,23,0.45)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Why it fits this tool</p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <p>1. Operators do not land on a shared global dashboard anymore.</p>
                <p>2. The registration email becomes the default off-air alert recipient for that customer.</p>
                <p>3. Nodes stay empty by default until the local setup mirrors into that customer’s hub.</p>
                <p>4. Discovery reports and provisioned configs stay aligned to the right tenant.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-sm font-semibold text-white">Discovery-first setup</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Run the scanner while the player is active, upload the report, and review the auto-filled paths and logs.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-sm font-semibold text-white">Protected hub access</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Authenticated dashboards, tenant-specific nodes, and alert settings that can be changed later.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
