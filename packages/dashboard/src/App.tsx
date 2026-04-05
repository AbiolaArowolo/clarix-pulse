import React, { useEffect } from 'react';
import { AppFrame } from './components/AppFrame';
import { useAuth } from './features/auth/AuthProvider';
import { navigate, usePathname } from './hooks/usePathname';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { InstallHandoffPage } from './pages/InstallHandoffPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringDashboardPage } from './pages/MonitoringDashboardPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { initInstallPromptTracking } from './lib/installPrompt';

initInstallPromptTracking();

function protectedPageMeta(pathname: string): { title: string; description: string } {
  if (pathname === '/app/onboarding') {
    return {
      title: 'Onboard a New Source',
      description: 'Bring a new Windows node online using discovery, provisioning, and local installation in that order.',
    };
  }

  if (pathname === '/app/account') {
    return {
      title: 'Account and Downloads',
      description: 'Review access status, secure installer links, the default alert email, and fallback access details.',
    };
  }

  if (pathname === '/app/admin') {
    return {
      title: 'Customer Access Control',
      description: 'Enable or disable customer accounts, renew access keys, and keep activation under platform control.',
    };
  }

  return {
    title: 'Operations Overview',
    description: 'Watch live risk, review source health, and provision new monitored nodes from one control surface.',
  };
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-white">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/70 px-6 py-5 text-sm text-slate-300 shadow-[0_24px_90px_rgba(2,6,23,0.42)]">
        Loading Clarix Pulse...
      </div>
    </div>
  );
}

export default function App() {
  const pathname = usePathname();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.bootstrapped) {
      return;
    }

    if (!auth.authenticated && pathname.startsWith('/app')) {
      navigate('/login', true);
      return;
    }

    if (auth.authenticated && pathname === '/app/admin' && !auth.user?.isPlatformAdmin) {
      navigate('/app', true);
      return;
    }

    if (
      auth.authenticated
      && (
        pathname === '/'
        || pathname === '/login'
        || pathname === '/register'
        || pathname === '/forgot-password'
        || pathname === '/reset-password'
      )
    ) {
      navigate('/app', true);
    }
  }, [auth.authenticated, auth.bootstrapped, auth.user?.isPlatformAdmin, pathname]);

  if (!auth.bootstrapped && pathname.startsWith('/app')) {
    return <LoadingScreen />;
  }

  const go = (nextPath: string) => {
    auth.clearError();
    navigate(nextPath);
  };

  if (pathname === '/forgot-password') {
    return <ForgotPasswordPage onNavigate={go} />;
  }

  if (pathname === '/reset-password') {
    return <ResetPasswordPage onNavigate={go} />;
  }

  if (pathname === '/install-handoff') {
    return <InstallHandoffPage onNavigate={go} />;
  }

  if (!auth.authenticated) {
    if (pathname === '/login') {
      return (
        <LoginPage
          loading={auth.loading}
          error={auth.error}
          notice={auth.notice}
          registration={auth.registration}
          onNavigate={go}
          onLogin={async (input) => {
            const ok = await auth.login(input);
            if (ok) {
              navigate('/app', true);
            }
          }}
        />
      );
    }

    if (pathname === '/register') {
      return (
        <RegisterPage
          loading={auth.loading}
          error={auth.error}
          notice={auth.notice}
          registration={auth.registration}
          onNavigate={go}
          onRegister={async (input) => {
            await auth.register(input);
          }}
        />
      );
    }

    return <LandingPage onNavigate={go} />;
  }

  const session = {
    user: auth.user!,
    tenant: auth.tenant!,
    impersonation: auth.impersonation,
  };
  const meta = protectedPageMeta(pathname);

  let content: React.ReactNode;
  if (pathname === '/app/onboarding') {
    content = <OnboardingPage session={session} onNavigate={go} />;
  } else if (pathname === '/app/account') {
    content = <AccountPage session={session} />;
  } else if (pathname === '/app/admin' && session.user.isPlatformAdmin) {
    content = <AdminPage onNavigate={go} onRefreshSession={auth.refreshSession} />;
  } else {
    content = <MonitoringDashboardPage onNavigate={go} />;
  }

  return (
    <AppFrame
      session={session}
      currentPath={pathname}
      title={meta.title}
      description={meta.description}
      onNavigate={go}
      onStopImpersonation={() => {
        void auth.stopImpersonation().then((ok) => {
          if (ok) {
            navigate('/app/admin', true);
          }
        });
      }}
      onLogout={() => {
        void auth.logout().then(() => navigate('/login', true));
      }}
    >
      {content}
    </AppFrame>
  );
}
