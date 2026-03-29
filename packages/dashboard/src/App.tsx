import React, { useEffect } from 'react';
import { AppFrame } from './components/AppFrame';
import { useAuth } from './features/auth/AuthProvider';
import { navigate, usePathname } from './hooks/usePathname';
import { AccountPage } from './pages/AccountPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MonitoringDashboardPage } from './pages/MonitoringDashboardPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RegisterPage } from './pages/RegisterPage';

function protectedPageMeta(pathname: string): { title: string; description: string } {
  if (pathname === '/app/onboarding') {
    return {
      title: 'Onboard a New Node',
      description: 'Bring a new Windows playout node online using discovery, provisioning, and local install in that order.',
    };
  }

  if (pathname === '/app/account') {
    return {
      title: 'Account and Access',
      description: 'Review the current tenant, the registration email that seeded default alerts, and the fallback enrollment key.',
    };
  }

  return {
    title: 'Monitoring Dashboard',
    description: 'Track off-air risk, review node health, and provision new nodes into this tenant without exposing other customers.',
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
    if (auth.loading) {
      return;
    }

    if (!auth.authenticated && pathname.startsWith('/app')) {
      navigate('/login', true);
      return;
    }

    if (auth.authenticated && (pathname === '/' || pathname === '/login' || pathname === '/register')) {
      navigate('/app', true);
    }
  }, [auth.authenticated, auth.loading, pathname]);

  if (auth.loading) {
    return <LoadingScreen />;
  }

  const go = (nextPath: string) => {
    auth.clearError();
    navigate(nextPath);
  };

  if (!auth.authenticated) {
    if (pathname === '/login') {
      return (
        <LoginPage
          loading={auth.loading}
          error={auth.error}
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
          onNavigate={go}
          onRegister={async (input) => {
            const ok = await auth.register(input);
            if (ok) {
              navigate('/app', true);
            }
          }}
        />
      );
    }

    return <LandingPage onNavigate={go} />;
  }

  const session = {
    user: auth.user!,
    tenant: auth.tenant!,
  };
  const meta = protectedPageMeta(pathname);

  let content: React.ReactNode;
  if (pathname === '/app/onboarding') {
    content = <OnboardingPage session={session} onNavigate={go} />;
  } else if (pathname === '/app/account') {
    content = <AccountPage session={session} />;
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
      onLogout={() => {
        void auth.logout().then(() => navigate('/login', true));
      }}
    >
      {content}
    </AppFrame>
  );
}
