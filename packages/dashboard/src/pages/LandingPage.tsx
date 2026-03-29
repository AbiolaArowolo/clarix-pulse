import React from 'react';

const PREVIEW_ITEMS = [
  {
    label: 'Process watch',
    state: 'Stable',
    detail: 'Signals, heartbeats, and logs aligned in the last review window.',
  },
  {
    label: 'Verification',
    state: 'Ready',
    detail: 'Recent changes can be traced back to source, system, and operator context.',
  },
  {
    label: 'Response path',
    state: 'Connected',
    detail: 'Alerts route to the right team, with evidence attached before escalation.',
  },
];

const OUTCOMES = [
  'Detect silent failures earlier',
  'Verify incidents with evidence',
  'Keep teams aligned during live operations',
];

export function LandingPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  return (
    <div className="min-h-dvh bg-[#08131f] text-white">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-slate-800/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
              <img src="/pulse.svg" alt="Clarix Pulse logo" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-200">Clarix Pulse</p>
              <p className="text-sm text-slate-400">Operational visibility for critical workflows</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/register')}
              className="rounded-full border border-slate-600 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-white"
            >
              Create account
            </button>
          </div>
        </header>

        <main className="flex flex-1 items-center py-12">
          <section className="grid w-full gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Live monitoring made practical</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-white sm:text-5xl">
                See operational issues sooner, verify them faster, and respond with confidence.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
                Clarix Pulse brings signal checks, machine state, logs, and alerting into one clean workspace so teams can monitor critical processes without guesswork.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-slate-100"
                >
                  Start with Clarix Pulse
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/login')}
                  className="rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Open your workspace
                </button>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {OUTCOMES.map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-4">
                    <p className="text-sm text-slate-200">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <aside className="rounded-[28px] border border-slate-800 bg-slate-950/80 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.34)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Monitoring preview</p>
                  <p className="mt-2 text-lg font-semibold text-white">A calmer view of active health</p>
                </div>
                <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                  Live
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {PREVIEW_ITEMS.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                        {item.state}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}
