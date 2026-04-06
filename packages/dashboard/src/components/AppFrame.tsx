import React from 'react';
import { useTheme } from './ThemeProvider';

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

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
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
  const { colorMode, theme, themeLabel, cycleTheme } = useTheme();
  const isDark = colorMode === 'dark';

  const navItems = [
    { id: '/app/onboarding', label: 'Onboarding' },
    { id: '/app', label: 'Dashboard' },
    { id: '/app/account', label: 'Account' },
    ...(session.user.isPlatformAdmin ? [{ id: '/app/admin', label: 'Admin' }] : []),
  ];
  const accessState = session.tenant.enabled ? 'Access active' : 'Access pending';

  const headerBg = isDark
    ? 'border-slate-800/80 bg-slate-950/82 backdrop-blur-xl'
    : 'border-slate-200 bg-white/90 backdrop-blur-xl shadow-sm';

  const navInactive = isDark
    ? 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white'
    : 'border-slate-200 bg-white text-slate-600 hover:border-teal-400/50 hover:text-slate-900 shadow-sm';

  const navActive = isDark
    ? 'border-cyan-400/50 bg-cyan-400/14 text-cyan-50'
    : 'border-teal-500/60 bg-teal-50 text-teal-800';

  const signOutBtn = isDark
    ? 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-red-400/40 hover:text-white'
    : 'border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:text-red-700 shadow-sm';

  const themeBtn = isDark
    ? 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white'
    : 'border-slate-200 bg-white text-slate-500 hover:border-teal-400/60 hover:text-slate-900 shadow-sm';

  const infoCard = isDark
    ? 'border-slate-800 bg-slate-900/70 text-slate-300 shadow-[0_18px_45px_rgba(2,6,23,0.32)]'
    : 'border-slate-200 bg-white text-slate-500 shadow-sm';

  const themeIcon = theme === 'system' ? <MonitorIcon /> : colorMode === 'light' ? <SunIcon /> : <MoonIcon />;

  return (
    <div className={`relative min-h-dvh overflow-hidden ${isDark ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>

      {/* Background gradients */}
      {isDark ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_22%),linear-gradient(180deg,#020617_0%,#0f172a_58%,#111827_100%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,rgba(6,182,212,0.12),transparent)]" />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(13,148,136,0.07),transparent_60%)]" />
      )}

      {/* Header */}
      <header className={`relative z-20 border-b ${headerBg}`}>
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
                <p className={`text-[11px] uppercase tracking-[0.24em] ${isDark ? 'text-cyan-200' : 'text-teal-600'}`}>
                  {session.tenant.slug}
                </p>
                <h1 className={`truncate text-lg font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {session.tenant.name}
                </h1>
                <p className={`truncate text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {session.user.displayName} | {session.user.email}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <nav className="flex flex-wrap gap-2" aria-label="Main navigation">
                {navItems.map((item) => {
                  const active = isActivePath(currentPath, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${active ? navActive : navInactive}`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2">
                {/* Theme toggle */}
                <button
                  type="button"
                  onClick={cycleTheme}
                  title={`Theme: ${themeLabel} - click to cycle`}
                  aria-label={`Current theme: ${themeLabel}. Click to change.`}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${themeBtn}`}
                >
                  {themeIcon}
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${signOutBtn}`}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className={`text-[11px] uppercase tracking-[0.24em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Clarix Pulse
              </p>
              <h2 className={`mt-2 text-2xl font-semibold sm:text-3xl ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {title}
              </h2>
              <p className={`mt-2 max-w-2xl text-sm leading-6 ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>
                {description}
              </p>
            </div>

            <div className={`rounded-2xl border px-4 py-3 text-sm ${infoCard}`}>
              <span className={`font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>{accessState}</span>
              {' '}| Alerts default to{' '}
              <span className={`font-semibold ${isDark ? 'text-white' : 'text-slate-800'}`}>
                {session.tenant.defaultAlertEmail ?? session.user.email}
              </span>
              {' '}until you change them.
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
