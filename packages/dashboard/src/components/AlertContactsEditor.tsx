import React, { useEffect, useMemo, useState } from 'react';
import { readStoredConfigWriteKey, storeConfigWriteKey } from '../lib/configWriteKey';

interface AlertSettingsPayload {
  settings: {
    emailRecipients: string[];
    telegramChatIds: string[];
    phoneNumbers: string[];
    updatedAt: string | null;
  };
  capabilities: {
    emailDeliveryConfigured: boolean;
    telegramDeliveryConfigured: boolean;
    phoneDeliveryConfigured: boolean;
  };
}

interface ContactDraft {
  emailRecipients: string[];
  telegramChatIds: string[];
  phoneNumbers: string[];
}

const EMPTY_CONTACTS = ['', '', ''];

function padContacts(values: string[]): string[] {
  return [...values.slice(0, 3), ...EMPTY_CONTACTS].slice(0, 3);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return 'never';

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function normalizeDraft(values: string[]): string[] {
  const deduped = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned || deduped.has(cleaned)) continue;
    deduped.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized.slice(0, 3);
}

export function AlertContactsEditor() {
  const [open, setOpen] = useState(false);
  const [writeKey, setWriteKey] = useState(() => readStoredConfigWriteKey());
  const [draft, setDraft] = useState<ContactDraft>({
    emailRecipients: [...EMPTY_CONTACTS],
    telegramChatIds: [...EMPTY_CONTACTS],
    phoneNumbers: [...EMPTY_CONTACTS],
  });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AlertSettingsPayload['capabilities']>({
    emailDeliveryConfigured: false,
    telegramDeliveryConfigured: false,
    phoneDeliveryConfigured: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = useMemo(() => ({
    emails: normalizeDraft(draft.emailRecipients).length,
    telegram: normalizeDraft(draft.telegramChatIds).length,
    phones: normalizeDraft(draft.phoneNumbers).length,
  }), [draft]);

  const loadSettings = async () => {
    if (!writeKey.trim()) {
      setError('Enter the config write key to load alert contacts.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/config/alerts', {
        headers: {
          'x-config-write-key': writeKey.trim(),
        },
      });
      const payload = await response.json() as AlertSettingsPayload & { error?: string };
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to load alert contacts.'));
      }

      const data = payload as AlertSettingsPayload;
      setDraft({
        emailRecipients: padContacts(data.settings.emailRecipients ?? []),
        telegramChatIds: padContacts(data.settings.telegramChatIds ?? []),
        phoneNumbers: padContacts(data.settings.phoneNumbers ?? []),
      });
      setUpdatedAt(data.settings.updatedAt ?? null);
      setCapabilities(data.capabilities);
      storeConfigWriteKey(writeKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alert contacts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || loading || !writeKey.trim()) return;
    if (updatedAt || error || notice) return;
    void loadSettings();
  }, [error, loading, notice, open, updatedAt, writeKey]);

  const updateField = (channel: keyof ContactDraft, index: number, value: string) => {
    setDraft((current) => ({
      ...current,
      [channel]: current[channel].map((entry, entryIndex) => (
        entryIndex === index ? value : entry
      )),
    }));
  };

  const saveSettings = async () => {
    if (!writeKey.trim()) {
      setError('Enter the config write key before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/config/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-config-write-key': writeKey.trim(),
        },
        body: JSON.stringify({
          emailRecipients: normalizeDraft(draft.emailRecipients),
          telegramChatIds: normalizeDraft(draft.telegramChatIds),
          phoneNumbers: normalizeDraft(draft.phoneNumbers),
        }),
      });
      const payload = await response.json() as AlertSettingsPayload & { error?: string };
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to save alert contacts.'));
      }

      const data = payload as AlertSettingsPayload;
      setDraft({
        emailRecipients: padContacts(data.settings.emailRecipients ?? []),
        telegramChatIds: padContacts(data.settings.telegramChatIds ?? []),
        phoneNumbers: padContacts(data.settings.phoneNumbers ?? []),
      });
      setUpdatedAt(data.settings.updatedAt ?? new Date().toISOString());
      setCapabilities(data.capabilities);
      setNotice('Saved. These contacts now apply to alerts from all monitored nodes.');
      storeConfigWriteKey(writeKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save alert contacts.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/58 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-100">Alert Contacts</h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure who receives hub-wide alert notifications from every node.
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Last saved {formatUpdatedAt(updatedAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.emails} email
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.telegram} telegram
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.phones} phone
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value);
              setError(null);
              setNotice(null);
            }}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            {open ? 'Hide settings' : 'Alert settings'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="password"
              value={writeKey}
              onChange={(event) => setWriteKey(event.target.value)}
              placeholder="Config write key"
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
            />
            <button
              type="button"
              onClick={() => void loadSettings()}
              disabled={loading}
              className="rounded-xl border border-teal-600/50 bg-teal-700/20 px-3 py-2 text-sm font-medium text-teal-100 transition-colors hover:border-teal-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Loading...' : 'Load'}
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Email Recipients</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  One to three optional email destinations for SMTP alert delivery.
                </p>
              </div>
              <div className="space-y-2">
                {draft.emailRecipients.map((value, index) => (
                  <input
                    key={`email-${index}`}
                    type="email"
                    value={value}
                    onChange={(event) => updateField('emailRecipients', index, event.target.value)}
                    placeholder={`Email ${index + 1}`}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Telegram Targets</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  One to three optional Telegram chat IDs. A bot token still has to be configured on the hub.
                </p>
              </div>
              <div className="space-y-2">
                {draft.telegramChatIds.map((value, index) => (
                  <input
                    key={`telegram-${index}`}
                    type="text"
                    value={value}
                    onChange={(event) => updateField('telegramChatIds', index, event.target.value)}
                    placeholder={`Telegram chat ID ${index + 1}`}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Phone Contacts</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  One to three optional phone numbers stored for escalation workflows and future SMS or call integration.
                </p>
              </div>
              <div className="space-y-2">
                {draft.phoneNumbers.map((value, index) => (
                  <input
                    key={`phone-${index}`}
                    type="tel"
                    value={value}
                    onChange={(event) => updateField('phoneNumbers', index, event.target.value)}
                    placeholder={`Phone ${index + 1}`}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-2 text-[11px] text-slate-500 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              SMTP delivery: <span className={capabilities.emailDeliveryConfigured ? 'text-emerald-300' : 'text-yellow-300'}>
                {capabilities.emailDeliveryConfigured ? 'configured' : 'not configured'}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              Telegram bot: <span className={capabilities.telegramDeliveryConfigured ? 'text-emerald-300' : 'text-yellow-300'}>
                {capabilities.telegramDeliveryConfigured ? 'configured' : 'not configured'}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
              Phone delivery: <span className="text-yellow-300">stored only</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving}
            className="w-full rounded-xl border border-yellow-600/60 bg-yellow-500/15 px-4 py-2 text-sm font-semibold text-yellow-100 transition-colors hover:border-yellow-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save alert contacts'}
          </button>

          {notice && (
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs text-emerald-200">
              {notice}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-700/40 bg-red-900/20 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
