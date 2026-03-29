import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;

  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIPhoneLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isFirefoxLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Firefox/i.test(navigator.userAgent);
}

function needsLanFriendlyUrl(shareUrl: string): boolean {
  if (!shareUrl) return false;

  try {
    const { hostname } = new URL(shareUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', onAppInstalled);

    if (isStandaloneDisplay()) {
      setInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';

    return new URL('/app', window.location.origin).toString();
  }, []);

  const install = async () => {
    if (!promptEvent) return false;

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
      setPromptEvent(null);
      return true;
    }

    return false;
  };

  const copyLink = async () => {
    if (!shareUrl || !navigator.clipboard) return false;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false;
    }
  };

  const share = async () => {
    if (!shareUrl || !navigator.share) return false;

    try {
      await navigator.share({
        title: 'Clarix Pulse',
        text: 'Open the Clarix Pulse workspace',
        url: shareUrl,
      });
      return true;
    } catch {
      return false;
    }
  };

  return {
    canInstall: Boolean(promptEvent),
    canShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    copied,
    installed,
    isIPhoneLike: isIPhoneLike(),
    isFirefoxLike: isFirefoxLike(),
    needsLanUrl: needsLanFriendlyUrl(shareUrl),
    shareUrl,
    install,
    copyLink,
    share,
  };
}

export function InstallWorkspacePanel() {
  const [showQr, setShowQr] = useState(false);
  const {
    canInstall,
    canShare,
    copied,
    installed,
    isIPhoneLike,
    isFirefoxLike,
    needsLanUrl,
    shareUrl,
    install,
    copyLink,
    share,
  } = useInstallPrompt();

  const installHint = installed
    ? 'This device already has the workspace installed as an app.'
    : isIPhoneLike
      ? 'On iPhone or iPad, use Share and then Add to Home Screen.'
      : isFirefoxLike
        ? 'For app install, open this same page in Chrome or Edge.'
        : canInstall
          ? 'Use Install for a cleaner full-screen workspace.'
          : 'If Install is not shown yet, use Chrome or Edge and choose Install app from the browser menu.';

  const qrHint = needsLanUrl
    ? 'Use a LAN-accessible URL instead of localhost for phone installs on the same network.'
    : 'Scan the QR code from a phone to open this exact workspace URL.';

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-5 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center">
              <img src="/pulse.svg" alt="Clarix Pulse logo" className="pulse-logo h-full w-full object-contain" />
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Install workspace app</h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Keep a clean app-style workspace on this device, or hand the current workspace link to a phone with QR.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {!installed && canInstall && (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-full border border-cyan-400/35 bg-cyan-400/12 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-300"
              >
                Install app
              </button>
            )}

            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
              >
                Share link
              </button>
            )}

            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>

            <button
              type="button"
              onClick={() => setShowQr((value) => !value)}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white lg:hidden"
            >
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-800 bg-slate-950/55 p-4">
            <p className="text-sm text-slate-200">{installHint}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{qrHint}</p>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-cyan-100">
              {shareUrl}
            </div>
          </div>
        </div>

        <div className={`${showQr ? 'block' : 'hidden'} lg:block`}>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/78 p-4 shadow-[0_18px_44px_rgba(2,6,23,0.34)]">
            <div className="rounded-2xl bg-white p-3">
              <QRCodeSVG
                value={shareUrl || 'https://pulse.clarixtech.com/app'}
                size={138}
                marginSize={1}
                bgColor="#ffffff"
                fgColor="#020617"
                includeMargin={false}
              />
            </div>
            <p className="mt-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Workspace QR</p>
            <p className="mt-2 max-w-[164px] text-center text-[11px] leading-5 text-slate-500">
              Scan from a phone or secondary device to open this exact workspace address.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
