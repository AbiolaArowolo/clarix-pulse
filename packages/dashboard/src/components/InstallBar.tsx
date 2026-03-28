import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const DISMISS_KEY = 'pulse.install_bar.dismissed';
const COLLAPSE_KEY = 'pulse.install_bar.collapsed';
const AUTO_COLLAPSE_MS = 12000;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

export type InstallBarMode = 'hidden' | 'collapsed' | 'expanded';

interface Props {
  onModeChange?: (mode: InstallBarMode) => void;
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

function readStoredBoolean(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback;

  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') return;

  try {
    if (value) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
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

  const shareUrl = useMemo(() => (typeof window === 'undefined' ? '' : window.location.href), []);

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
        title: 'Pulse',
        text: 'Pulse broadcast monitor',
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
    shareUrl,
    install,
    copyLink,
    share,
  };
}

export function InstallBar({ onModeChange }: Props) {
  const [showQr, setShowQr] = useState(false);
  const [dismissed, setDismissed] = useState(() => readStoredBoolean(DISMISS_KEY));
  const [collapsed, setCollapsed] = useState(() => readStoredBoolean(COLLAPSE_KEY));
  const {
    canInstall,
    canShare,
    copied,
    installed,
    isIPhoneLike,
    shareUrl,
    install,
    copyLink,
    share,
  } = useInstallPrompt();
  const firefoxLike = isFirefoxLike();
  const needsLanUrl = needsLanFriendlyUrl(shareUrl);
  const installHint = isIPhoneLike
    ? 'On iPhone or iPad: use Share, then Add to Home Screen. Safari does not show a separate Install button.'
    : firefoxLike
      ? 'Firefox does not offer the same PWA install flow here. Open Pulse in Chrome or Edge to install it as an app.'
    : canInstall
      ? 'Use Install for the full-screen app experience.'
      : 'If no Install button appears yet, use Chrome or Edge and choose Install app or Add to desktop from the browser menu.';
  const qrHint = needsLanUrl
    ? 'Use a LAN URL instead of localhost if you want phone installs on the same network.'
    : 'Scan this code from a phone on the same network to open Pulse instantly.';
  const mode: InstallBarMode = installed
    ? 'hidden'
    : dismissed
      ? 'hidden'
      : collapsed
        ? 'collapsed'
        : 'expanded';

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    if (installed || dismissed || collapsed) return undefined;

    const timer = window.setTimeout(() => {
      setCollapsed(true);
      writeStoredBoolean(COLLAPSE_KEY, true);
    }, AUTO_COLLAPSE_MS);

    return () => window.clearTimeout(timer);
  }, [collapsed, dismissed, installed]);

  const expandPanel = () => {
    setDismissed(false);
    setCollapsed(false);
    writeStoredBoolean(DISMISS_KEY, false);
    writeStoredBoolean(COLLAPSE_KEY, false);
  };

  const collapsePanel = () => {
    setCollapsed(true);
    writeStoredBoolean(COLLAPSE_KEY, true);
  };

  const dismissPanel = () => {
    setDismissed(true);
    writeStoredBoolean(DISMISS_KEY, true);
  };

  if (installed) {
    return null;
  }

  if (mode !== 'expanded') {
    return (
      <div
        className="fixed bottom-3 right-3 z-30 flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/95 px-3 py-3 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={expandPanel}
          className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400"
        >
          {canInstall ? 'Install Pulse' : isIPhoneLike ? 'Add to Home' : firefoxLike ? 'Use Chrome/Edge' : 'Install Help'}
        </button>
        {mode === 'collapsed' && (
          <button
            type="button"
            onClick={dismissPanel}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800"
          >
            Hide
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800/80 bg-slate-950/94 backdrop-blur sm:bottom-3 sm:left-3 sm:right-3 sm:rounded-3xl sm:border sm:shadow-[0_24px_70px_rgba(2,6,23,0.5)]"
      style={{ paddingBottom: 'calc(0.9rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-blue-400/20 bg-[#071538] shadow-[0_16px_34px_rgba(7,21,56,0.52)]">
              <img src="/pulse.svg" alt="Pulse logo" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">Install Pulse on this device</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Add the dashboard to your home screen for faster access, better mobile layout, and app-like monitoring.
                  </p>
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={collapsePanel}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                  >
                    Collapse
                  </button>
                  <button
                    type="button"
                    onClick={dismissPanel}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                <span className="rounded-full border border-slate-700 px-2 py-0.5">Installable PWA</span>
                <span className="rounded-full border border-slate-700 px-2 py-0.5">Offline shell</span>
                <span className="rounded-full border border-slate-700 px-2 py-0.5">Mobile alerts</span>
                <span className="rounded-full border border-slate-700 px-2 py-0.5">QR launch</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">{installHint}</p>
              {firefoxLike && (
                <p className="mt-1 text-[11px] leading-5 text-yellow-300">
                  Best result: open this same URL in Chrome or Edge, then install from there.
                </p>
              )}
              <p className="mt-1 text-[11px] leading-5 text-slate-500">{qrHint}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:w-auto lg:flex-col lg:items-stretch">
            {canInstall ? (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-400"
              >
                Install
              </button>
            ) : null}

            {canShare ? (
              <button
                type="button"
                onClick={() => void share()}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-700"
              >
                Share
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void copyLink()}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>

            <button
              type="button"
              onClick={() => setShowQr((value) => !value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800 lg:hidden"
            >
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>

            <button
              type="button"
              onClick={collapsePanel}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800 sm:hidden"
            >
              Collapse
            </button>

            <button
              type="button"
              onClick={dismissPanel}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800 sm:hidden"
            >
              Hide
            </button>
          </div>

          <div className={`${showQr ? 'block' : 'hidden'} lg:block`}>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-3 shadow-[0_10px_30px_rgba(2,6,23,0.3)]">
              <div className="rounded-2xl bg-white p-3">
                <QRCodeSVG
                  value={shareUrl || 'https://monitor.example.com'}
                  size={120}
                  marginSize={1}
                  bgColor="#ffffff"
                  fgColor="#020617"
                  includeMargin={false}
                />
              </div>
              <p className="mt-2 text-center text-[11px] font-medium text-slate-300">Phone install QR</p>
              <p className="mt-1 max-w-[140px] text-center text-[10px] leading-4 text-slate-500">
                Scan this from a phone to open the current Pulse address.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="truncate">
            {isIPhoneLike ? 'Best on iPhone: Share > Add to Home Screen' : 'Best on Android and desktop: use Install when it appears'}
          </span>
          <span className="truncate text-left sm:text-right">{shareUrl}</span>
        </div>
      </div>
    </div>
  );
}
