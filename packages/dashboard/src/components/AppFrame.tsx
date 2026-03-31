import React from 'react';

interface SessionShape {
  user: {
    email: string;
    displayName: string;
    isPlatformAdmin?: boolean;
  };
  tenant: {
    name: string;
    slug: string;
    defaultAlertEmail: string | null;
    enabled?: boolean;
    accessKeyExpiresAt?: string | null;
  };
  impersonation?: {
    active: boolean;
    impersonatorEmail?: string | null;
    startedAt?: string | null;
  } | null;
}

interface Props {
  session: SessionShape;
  currentPath: string;
  title: string;
  description: string;
  onNavigate: (pathname: string) => void;
  onStopImpersonation: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

function isActivePath(currentPath: string, navPath: string): boolean {
  return currentPath === navPath || (navPath !== '/app' && currentPath.startsWith(`${navPath}/`));
}

export function AppFrame({
  session,
  currentPath,
  title,
  description,
  onNavigate,
  onStopImpersonation,
  onLogout,
  children,
}: Props) {
  const navItems = [
    { id: '/app/onboarding', label: 'Onboarding' },
    { id: '/app', label: 'Dashboard' },
    { id: '/app/account', label: 'Account' },
    ...(session.user.isPlatformAdmin ? [{ id: '/app/admin', label: 'Admin' }] : []),
  ];
  const accessState = session.tenant.enabled ? 'Access active' : 'Access pending';

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_22%),linear-gradient(180deg,#020617_0%,#0f172a_58%,#111827_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,rgba(6,182,212,0.12),transparent)]" />

      <header className="relative z-20 border-b border-slate-800/80 bg-slate-950/82 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          {session.impersonation?.active && (
            <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-amber-400/30 bg-amber-400/10 px-4 py-4 text-sm text-amber-50 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold">Support workspace view</p>
                <p className="mt-1 text-amber-100/85">
                  You are viewing this tenant as an administrator.
                  {session.impersonation.impersonatorEmail ? ` Original admin account: ${session.impersonation.impersonatorEmail}.` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onStopImpersonation}
                className="rounded-full border border-amber-200/35 bg-amber-200/10 px-4 py-2 text-sm font-semibold text-amber-50 transition-colors hover:border-amber-100"
              >
                Return to admin
              </button>
            </div>
          )}

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('/')}
                className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform hover:scale-[1.02]"
              >
                <img src="/pulse.svg" alt="Pulse logo" className="pulse-logo h-full w-full object-contain" />
              </button>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">{session.tenant.slug}</p>
                <h1 className="truncate text-lg font-semibold text-white">{session.tenant.name}</h1>
                <p className="truncate text-sm text-slate-400">{session.user.displayName} | {session.user.email}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <nav className="flex flex-wrap gap-2">
                {navItems.map((item) => {
                  const active = isActivePath(currentPath, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'border-cyan-400/50 bg-cyan-400/14 text-cyan-50'
                          : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              <button
                type="button"
                onClick={onLogout}
                className="rounded-full border border-slate-700 bg-slate-900/70 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-red-400/40 hover:text-white"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Clarix Pulse</p>
              <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{description}</p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300 shadow-[0_18px_45px_rgba(2,6,23,0.32)]">
              <span className="font-semibold text-white">{accessState}</span> | Alerts default to <span className="font-semibold text-white">{session.tenant.defaultAlertEmail ?? session.user.email}</span> until you change them.
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
