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

function formatDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
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

  const navItems = [
    { id: '/app/onboarding', label: 'Onboarding' },
    { id: '/app', label: 'Dashboard' },
    { id: '/app/account', label: 'Account' },
    ...(session.user.isPlatformAdmin ? [{ id: '/app/admin', label: 'Admin' }] : []),
  ];

  const accessState = session.tenant.enabled ? 'Access active' : 'Access pending';
  const defaultAlertTarget = session.tenant.defaultAlertEmail ?? session.user.email;
  const accessExpiryLabel = formatDateLabel(session.tenant.accessKeyExpiresAt);
  const themeIcon = theme === 'system' ? <MonitorIcon /> : colorMode === 'light' ? <SunIcon /> : <MoonIcon />;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="ui-shell-backdrop pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[linear-gradient(180deg,rgba(99,102,241,0.14),transparent)]" />

      <header className="ui-shell-header relative z-20 border-b backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          {session.impersonation?.active && (
            <div className="mb-5 flex flex-col gap-3 rounded-3xl border border-amber-400/30 bg-amber-400/10 px-4 py-4 text-sm text-amber-50 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="ui-kicker !text-amber-200">Support view</p>
                <p className="mt-1 text-amber-100/85">
                  You are viewing this tenant as an administrator.
                  {session.impersonation.impersonatorEmail ? ` Original admin account: ${session.impersonation.impersonatorEmail}.` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onStopImpersonation}
                className="ui-secondary-button px-4 py-2 text-sm font-semibold !border-amber-200/35 !bg-amber-200/10 !text-amber-50 hover:!border-amber-100"
              >
                Return to admin
              </button>
            </div>
          )}

          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate('/')}
                className="flex h-12 w-12 items-center justify-center rounded-[1.15rem] bg-white/[0.03] transition-transform hover:scale-[1.02]"
              >
                <img src="/pulse.svg" alt="Pulse logo" className="pulse-logo h-full w-full object-contain" />
              </button>

              <div className="min-w-0">
                <p className="ui-kicker">{session.tenant.slug}</p>
                <h1 className="mt-2 truncate text-xl font-semibold text-slate-50">
                  {session.tenant.name}
                </h1>
                <p className="mt-1 truncate text-sm text-slate-400">
                  {session.user.displayName} | {session.user.email}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-end">
              <nav className="flex flex-wrap gap-2" aria-label="Main navigation">
                {navItems.map((item) => {
                  const active = isActivePath(currentPath, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      data-active={active}
                      className="ui-nav-link px-4 py-2.5 text-sm font-medium"
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cycleTheme}
                  title={`Theme: ${themeLabel} - click to cycle`}
                  aria-label={`Current theme: ${themeLabel}. Click to change.`}
                  className="ui-icon-button flex h-10 w-10 items-center justify-center"
                >
                  {themeIcon}
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  className="ui-danger-button px-4 py-2.5 text-sm font-medium"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>

          <div className="mt-7 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
            <section className="ui-hero-panel min-w-0 px-5 py-5 sm:px-6 sm:py-6">
              <p className="ui-kicker-muted">Clarix Pulse workspace</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-slate-50 sm:text-4xl">
                {title}
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                {description}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-300">
                <span className={`ui-status-pill ${session.tenant.enabled ? 'status-green' : 'status-orange'}`}>
                  {accessState}
                </span>
                <span className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm text-slate-300">
                  Alerts route to <span className="font-semibold text-slate-100">{defaultAlertTarget}</span>
                </span>
              </div>
            </section>

            <aside className="ui-accent-card min-w-0 rounded-[var(--radius-hero)] px-5 py-5 sm:px-6 sm:py-6">
              <p className="ui-kicker-muted text-indigo-100">Workspace status</p>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-sm text-slate-300">Default alert contact</p>
                  <p className="mt-1 break-words text-lg font-semibold text-slate-50">{defaultAlertTarget}</p>
                </div>

                <div className="ui-quiet-rule h-px" />

                <div>
                  <p className="text-sm text-slate-300">Tenant slug</p>
                  <p className="mt-1 text-base font-semibold text-slate-100">{session.tenant.slug}</p>
                </div>

                {accessExpiryLabel && (
                  <>
                    <div className="ui-quiet-rule h-px" />
                    <div>
                      <p className="text-sm text-slate-300">Access key window</p>
                      <p className="mt-1 text-base font-semibold text-slate-100">Valid through {accessExpiryLabel}</p>
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
