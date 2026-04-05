export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

interface InstallPromptSnapshot {
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let initialized = false;
let promptEvent: BeforeInstallPromptEvent | null = null;
let installed = false;

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;

  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function initInstallPromptTracking(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;
  installed = isStandaloneDisplay();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    promptEvent = null;
    notify();
  });
}

export function subscribeInstallPrompt(listener: Listener): () => void {
  initInstallPromptTracking();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallPromptSnapshot(): InstallPromptSnapshot {
  initInstallPromptTracking();
  return {
    promptEvent,
    installed,
  };
}

export async function promptForInstall(): Promise<boolean> {
  initInstallPromptTracking();
  if (!promptEvent) return false;

  const event = promptEvent;
  promptEvent = null;
  notify();

  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') {
    installed = true;
    notify();
    return true;
  }

  notify();
  return false;
}
