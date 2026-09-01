import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { navigate } from './hooks/usePathname';
import './index.css';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisterError(error) {
    console.error('Service worker registration failed', error);
  },
});

// LEARN: Clerk owns identity/session cookies now (see DESIGN note in AuthProvider),
// so the dashboard needs its own publishable key at build time. This is a public
// key (safe to ship in the bundle) - the secret key stays server-side only, in the
// hub's env, never here. Vite only exposes env vars prefixed VITE_ to client code.
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (!clerkPublishableKey) {
  // Missing the key is a deploy misconfiguration, not a runtime state the UI
  // should try to paper over - ClerkProvider throws on an empty key, which
  // would otherwise surface as a blank white screen. Fail loud and specific
  // instead, both in the console and on screen.
  console.error(
    'Missing VITE_CLERK_PUBLISHABLE_KEY. Set it in packages/dashboard/.env.local (see .env.example) before running the dashboard.',
  );
  root.render(
    <div style={{
      display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center',
      background: '#020617', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center',
    }}
    >
      Configuration error: VITE_CLERK_PUBLISHABLE_KEY is not set. See packages/dashboard/.env.example.
    </div>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        routerPush={(to) => navigate(to)}
        routerReplace={(to) => navigate(to, true)}
      >
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </ClerkProvider>
    </React.StrictMode>,
  );
}
