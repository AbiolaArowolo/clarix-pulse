import React, { useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { PUBLIC_SOLUTIONS, PublicActivity, PublicSolutionId } from '../content/publicExperience';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface DemoEvent extends PublicActivity {
  id: string;
  timeLabel: string;
}

function formatClock(now: Date): { timeLabel: string; dateLabel: string } {
  return {
    timeLabel: new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(now),
    dateLabel: new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(now),
  };
}

function createDemoEvent(activity: PublicActivity, now: Date): DemoEvent {
  return {
    ...activity,
    id: `${activity.title}-${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
    timeLabel: new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(now),
  };
}

export function LandingPage({
  onNavigate,
}: {
  onNavigate: (pathname: string) => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [now, setNow] = useState(() => new Date());
  const [activeSolutionId, setActiveSolutionId] = useState<PublicSolutionId>('detect');
  const activeSolution = useMemo(
    () => PUBLIC_SOLUTIONS.find((solution) => solution.id === activeSolutionId) ?? PUBLIC_SOLUTIONS[0],
    [activeSolutionId],
  );
  const [demoEvents, setDemoEvents] = useState<DemoEvent[]>(() => {
    const initialNow = new Date();
    return activeSolution.activity
      .slice(0, 3)
      .map((activity, index) => createDemoEvent(activity, new Date(initialNow.getTime() - index * 18_000)))
      .reverse();
  });

  useEffect(() => {
    const initialNow = new Date();
    setDemoEvents(
      activeSolution.activity
        .slice(0, 3)
        .map((activity, index) => createDemoEvent(activity, new Date(initialNow.getTime() - index * 18_000)))
        .reverse(),
    );
  }, [activeSolution]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      return undefined;
    }

    let nextIndex = 0;
    const feed = window.setInterval(() => {
      setDemoEvents((current) => {
        const activity = activeSolution.activity[nextIndex % activeSolution.activity.length];
        nextIndex += 1;
        const nextEvent = createDemoEvent(activity, new Date());
        return [nextEvent, ...current].slice(0, 5);
      });
    }, 3200);

    return () => window.clearInterval(feed);
  }, [activeSolution, prefersReducedMotion]);

  const { timeLabel, dateLabel } = useMemo(() => formatClock(now), [now]);
  const counters = useMemo(() => {
    const redCount = demoEvents.filter((event) => event.color === 'red').length;
    const greenCount = demoEvents.filter((event) => event.color === 'green').length;
    return [
      { label: 'Live demo events', value: String(demoEvents.length).padStart(2, '0') },
      { label: 'Escalations raised', value: String(redCount).padStart(2, '0') },
      { label: 'Recoveries confirmed', value: String(greenCount).padStart(2, '0') },
    ];
  }, [demoEvents]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03111f] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.2),transparent_24%),radial-gradient(circle_at_84%_12%,rgba(34,197,94,0.12),transparent_20%),radial-gradient(circle_at_70%_70%,rgba(249,115,22,0.12),transparent_24%),linear-gradient(180deg,#03111f_0%,#071b2b_52%,#0b1322_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,rgba(6,182,212,0.16),transparent)]" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#071538] shadow-[0_16px_34px_rgba(7,21,56,0.52)]">
            <img src="/pulse.svg" alt="Clarix Pulse logo" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Clarix Pulse</p>
            <p className="text-sm text-slate-400">Operational visibility for complex workflows</p>
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

      <main className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:pt-14">
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge color="green" label="Live demo activity" size="md" />
              <div className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
                {dateLabel} | {timeLabel}
              </div>
              {prefersReducedMotion && (
                <div className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                  Reduced motion detected
                </div>
              )}
            </div>

            <h1 className="mt-6 text-4xl font-semibold leading-tight text-white sm:text-5xl">
              See the issues that usually stay invisible until operations are already under pressure.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              Clarix Pulse helps teams detect, verify, respond to, and learn from live operational issues across broadcast,
              logistics, manufacturing, utilities, and other environments where silence is expensive.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigate('/register')}
                className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-5 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
              >
                Start with Clarix Pulse
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/login')}
                className="rounded-full border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                Open your workspace
              </button>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {counters.map((counter) => (
                <div
                  key={counter.label}
                  className="rounded-3xl border border-slate-800 bg-slate-950/55 px-4 py-4 shadow-[0_16px_50px_rgba(2,12,27,0.24)] backdrop-blur"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{counter.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{counter.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-cyan-500/20 bg-slate-950/70 p-5 shadow-[0_28px_80px_rgba(2,12,27,0.45)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">Monitoring begins on the landing page</p>
                <p className="mt-2 text-lg font-semibold text-white">Demo activity rail</p>
              </div>
              <StatusBadge color="green" label={prefersReducedMotion ? 'Paused for accessibility' : 'Streaming demo'} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {PUBLIC_SOLUTIONS.map((solution) => {
                const active = solution.id === activeSolution.id;
                return (
                  <button
                    key={solution.id}
                    type="button"
                    onClick={() => setActiveSolutionId(solution.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'border-cyan-400/50 bg-cyan-400/14 text-cyan-50'
                        : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white'
                    }`}
                  >
                    {solution.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{activeSolution.eyebrow}</p>
              <p className="mt-2 text-xl font-semibold text-white">{activeSolution.title}</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">{activeSolution.summary}</p>
            </div>

            <div className="mt-5 space-y-3">
              {demoEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-3xl border border-slate-800 bg-slate-950/58 px-4 py-4 transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <StatusBadge color={event.color} label={event.metric} />
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{event.source}</span>
                    </div>
                    <span className="text-xs text-slate-500">{event.timeLabel}</span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-white">{event.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{event.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-[30px] border border-slate-800 bg-slate-950/58 p-6 shadow-[0_18px_55px_rgba(2,12,27,0.24)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{activeSolution.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">{activeSolution.label} with evidence, not guesswork</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {activeSolution.outcomes.map((outcome) => (
                <div key={outcome} className="rounded-3xl border border-slate-800 bg-slate-900/62 p-4">
                  <p className="text-sm font-semibold text-white">{outcome}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-800 bg-slate-950/58 p-6 shadow-[0_18px_55px_rgba(2,12,27,0.24)] backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Where teams use it</p>
            <div className="mt-4 space-y-3">
              {activeSolution.examples.map((example) => (
                <div key={example} className="rounded-3xl border border-slate-800 bg-slate-900/62 px-4 py-4 text-sm leading-6 text-slate-300">
                  {example}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
