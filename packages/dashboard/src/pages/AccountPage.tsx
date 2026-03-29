import React from 'react';

interface SessionShape {
  user: {
    displayName: string;
    email: string;
  };
  tenant: {
    name: string;
    slug: string;
    defaultAlertEmail: string | null;
    enrollmentKey: string;
  };
}

export function AccountPage({
  session,
}: {
  session: SessionShape;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Account details</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Company</p>
            <p className="mt-2 text-lg font-semibold text-white">{session.tenant.name}</p>
            <p className="mt-1 text-sm text-slate-400">{session.tenant.slug}</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Signed-in user</p>
            <p className="mt-2 text-lg font-semibold text-white">{session.user.displayName}</p>
            <p className="mt-1 text-sm text-slate-400">{session.user.email}</p>
          </div>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Alert default</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Registration seeded <span className="font-semibold text-white">{session.tenant.defaultAlertEmail ?? session.user.email}</span> as the default off-air alert recipient.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            You can change recipients at any time from Alert Contacts on the dashboard.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Enrollment key</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Keep this as a fallback for local self-enrollment when you cannot use a provisioned config.
          </p>
          <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
            {session.tenant.enrollmentKey}
          </div>
        </div>
      </aside>
    </div>
  );
}
