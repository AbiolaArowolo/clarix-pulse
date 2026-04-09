import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getInstallPromptSnapshot, promptForInstall, subscribeInstallPrompt } from '../lib/installPrompt';
import { PushNotificationToggle } from './PushNotificationToggle';

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
  const [installState, setInstallState] = useState(() => getInstallPromptSnapshot());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeInstallPrompt(() => {
      setInstallState(getInstallPromptSnapshot());
    });
  }, []);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';

    return new URL('/app', window.location.origin).toString();
  }, []);

  const install = async () => {
    return promptForInstall();
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
    canInstall: Boolean(installState.promptEvent),
    canShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    copied,
    installed: installState.installed,
    isIPhoneLike: isIPhoneLike(),
    isFirefoxLike: isFirefoxLike(),
    needsLanUrl: needsLanFriendlyUrl(shareUrl),
    shareUrl,
    install,
    copyLink,
    share,
  };
}

export function InstallWorkspacePanel({ layout = 'page' }: { layout?: 'page' | 'rail' }) {
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
  const isRailLayout = layout === 'rail';

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

  const qrCard = (
    <div className="ui-accent-card rounded-[var(--radius-panel)] px-5 py-5">
      <p className="ui-kicker-muted text-indigo-100">Workspace QR</p>
      <div className="mt-4 flex justify-center rounded-[var(--radius-panel)] bg-white p-4 shadow-[0_18px_44px_rgba(15,23,42,0.12)]">
        <QRCodeSVG
          value={shareUrl || 'https://pulse.clarixtech.com/app'}
          size={148}
          marginSize={1}
          bgColor="#ffffff"
          fgColor="#020617"
          includeMargin={false}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        Scan from a phone or secondary device to open this exact workspace address without retyping it.
      </p>
    </div>
  );

  return (
    <section className={`ui-shell-panel rounded-[var(--radius-panel)] ${isRailLayout ? 'px-4 py-4 sm:px-5 sm:py-5' : 'px-5 py-5 sm:px-6 sm:py-6'}`}>
      <div className={isRailLayout ? 'space-y-4' : 'grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)] xl:items-start'}>
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.15rem] bg-white/[0.04]">
              <img src="/pulse.svg" alt="Clarix Pulse logo" className="pulse-logo h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="ui-kicker-muted">Workspace install</p>
              <h3 className={`mt-3 font-semibold text-slate-50 ${isRailLayout ? 'text-2xl leading-tight' : 'text-2xl sm:text-3xl'}`}>
                Keep this workspace close on desktop and mobile.
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Install the app on this device for a cleaner full-screen experience, or hand off the current workspace link to another device with QR when operators need a faster route in.
              </p>
            </div>
          </div>

          <div className={isRailLayout ? 'mt-5 flex flex-col gap-3' : 'mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap'}>
            {!installed && canInstall && (
              <button
                type="button"
                onClick={() => void install()}
                className={`w-full rounded-[var(--radius-control)] border border-indigo-400/35 bg-indigo-400/14 px-4 py-2.5 text-sm font-semibold text-indigo-50 transition-colors hover:border-indigo-300 ${isRailLayout ? '' : 'sm:w-auto'}`}
              >
                Install app
              </button>
            )}

            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                className={`w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white ${isRailLayout ? '' : 'sm:w-auto'}`}
              >
                Share link
              </button>
            )}

            <button
              type="button"
              onClick={() => void copyLink()}
              className={`w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white ${isRailLayout ? '' : 'sm:w-auto'}`}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>

            {!isRailLayout && (
              <button
                type="button"
                onClick={() => setShowQr((value) => !value)}
                className="w-full rounded-[var(--radius-control)] border border-slate-700 bg-slate-900/75 px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500 hover:text-white sm:w-auto xl:hidden"
              >
                {showQr ? 'Hide QR' : 'Show QR'}
              </button>
            )}
          </div>

          <div className={`${isRailLayout ? 'mt-5' : 'mt-6'} rounded-[var(--radius-panel)] border border-slate-800/70 bg-slate-950/45 p-5`}>
            <div className={isRailLayout ? 'grid gap-4' : 'grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(240px,0.9fr)]'}>
              <div>
                <p className="ui-kicker-muted">Device hint</p>
                <p className="mt-3 text-sm leading-6 text-slate-300">{installHint}</p>
              </div>
              <div>
                <p className="ui-kicker-muted">Phone handoff</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{qrHint}</p>
              </div>
            </div>

            <div className="mt-4 rounded-[var(--radius-control)] border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-xs text-indigo-100 break-all whitespace-normal">
              {shareUrl}
            </div>
          </div>

          <PushNotificationToggle />
        </div>

        {isRailLayout ? qrCard : <div className={`${showQr ? 'block' : 'hidden'} xl:block`}>{qrCard}</div>}
      </div>
    </section>
  );
}
