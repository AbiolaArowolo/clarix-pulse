import React from 'react';

interface SessionShape {
  user: {
    email: string;
  };
  tenant: {
    enrollmentKey: string;
    defaultAlertEmail: string | null;
  };
}

export function OnboardingPage({
  session,
  onNavigate,
}: {
  session: SessionShape;
  onNavigate: (pathname: string) => void;
}) {
  const alertEmail = session.tenant.defaultAlertEmail ?? session.user.email;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Recommended onboarding flow</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">1. Prepare the node</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Download the latest Clarix Pulse bundle to the Windows node, start the player if possible, and run the discovery script while the player is active.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">2. Import the discovery report</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Open the dashboard, upload the report, review the auto-filled paths and log matches, then provision the node to mint its final config.
            </p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-white">3. Finish local install</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Import the provisioned <code>config.yaml</code> into the local UI, save settings, and install the agent service so the node starts mirroring into this hub.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="rounded-3xl border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(3,15,29,0.96),rgba(8,24,44,0.94)_45%,rgba(21,39,63,0.92))] p-5 shadow-[0_28px_90px_rgba(2,12,27,0.42)]">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-100">Install checklist</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
            <p>1. Open the Windows node and keep the playout application running if possible.</p>
            <p>2. Run <code>discover-node.ps1</code> so Clarix Pulse can infer paths, logs, and player hints.</p>
            <p>3. Upload the discovery report in the dashboard’s remote setup panel.</p>
            <p>4. Provision the node to generate a tenant-scoped <code>config.yaml</code>.</p>
            <p>5. Import that config into the local UI and save local settings.</p>
            <p>6. Install the service and confirm the node appears on the dashboard.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/app')}
            className="mt-5 rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
          >
            Open remote provisioning
          </button>
        </div>

        <aside className="space-y-5">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Default alert recipient</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Off-air alert emails start with <span className="font-semibold text-white">{alertEmail}</span>. You can change that later from Alert Contacts.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Enrollment key fallback</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Use the provisioned config flow first. If you still need enrollment-key setup from the local UI, this account’s current key is:
            </p>
            <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm text-cyan-100">
              {session.tenant.enrollmentKey}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
