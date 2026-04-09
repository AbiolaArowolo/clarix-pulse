import React, { useEffect, useMemo, useState } from 'react';
import { CollapsibleSection } from './CollapsibleSection';

interface AlertSettingsPayload {
  settings: {
    emailRecipients: string[];
    telegramChatIds: string[];
    phoneNumbers: string[];
    emailEnabled: boolean;
    telegramEnabled: boolean;
    phoneEnabled: boolean;
    updatedAt: string | null;
  };
  capabilities: {
    emailDeliveryConfigured: boolean;
    telegramDeliveryConfigured: boolean;
    phoneDeliveryConfigured: boolean;
  };
  error?: string;
}

interface TelegramTarget {
  chatId: string;
  recipient: string;
  title: string;
  subtitle: string;
}

interface TelegramTargetsPayload {
  targets: TelegramTarget[];
  configured: boolean;
  error?: string;
}

interface ContactDraft {
  emailRecipients: string[];
  telegramChatIds: string[];
  phoneNumbers: string[];
  emailEnabled: boolean;
  telegramEnabled: boolean;
  phoneEnabled: boolean;
}

type ContactListField = 'emailRecipients' | 'telegramChatIds' | 'phoneNumbers';

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

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    if (text.trim().startsWith('<')) {
      throw new Error('The server returned an HTML error page. Refresh and try again.');
    }

    throw new Error(fallbackMessage);
  }
}

export function AlertContactsEditor() {
  const [draft, setDraft] = useState<ContactDraft>({
    emailRecipients: [...EMPTY_CONTACTS],
    telegramChatIds: [...EMPTY_CONTACTS],
    phoneNumbers: [...EMPTY_CONTACTS],
    emailEnabled: true,
    telegramEnabled: true,
    phoneEnabled: false,
  });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AlertSettingsPayload['capabilities']>({
    emailDeliveryConfigured: false,
    telegramDeliveryConfigured: false,
    phoneDeliveryConfigured: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discoveringTelegram, setDiscoveringTelegram] = useState(false);
  const [telegramTargets, setTelegramTargets] = useState<TelegramTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const summary = useMemo(() => ({
    emails: normalizeDraft(draft.emailRecipients).length,
    telegram: normalizeDraft(draft.telegramChatIds).length,
    phones: normalizeDraft(draft.phoneNumbers).length,
  }), [draft]);

  const updateField = (channel: ContactListField, index: number, value: string) => {
    setDraft((current) => ({
      ...current,
      [channel]: current[channel].map((entry, entryIndex) => (
        entryIndex === index ? value : entry
      )),
    }));
  };

  const updateToggle = (channel: 'emailEnabled' | 'telegramEnabled' | 'phoneEnabled', value: boolean) => {
    setDraft((current) => ({
      ...current,
      [channel]: value,
    }));
  };

  const loadTelegramTargets = async () => {
    setDiscoveringTelegram(true);
    setError(null);

    try {
      const response = await fetch('/api/config/alerts/telegram-targets');
      const payload = await readJsonResponse<TelegramTargetsPayload>(
        response,
        'Failed to load Telegram conversations.',
      );
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to load Telegram conversations.'));
      }

      setTelegramTargets(Array.isArray(payload.targets) ? payload.targets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Telegram conversations.');
    } finally {
      setDiscoveringTelegram(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/config/alerts');
      const payload = await readJsonResponse<AlertSettingsPayload>(
        response,
        'Failed to load alert contacts.',
      );
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to load alert contacts.'));
      }

      setDraft({
        emailRecipients: padContacts(payload.settings.emailRecipients ?? []),
        telegramChatIds: padContacts(payload.settings.telegramChatIds ?? []),
        phoneNumbers: padContacts(payload.settings.phoneNumbers ?? []),
        emailEnabled: payload.settings.emailEnabled ?? true,
        telegramEnabled: payload.settings.telegramEnabled ?? true,
        phoneEnabled: payload.capabilities.phoneDeliveryConfigured
          ? (payload.settings.phoneEnabled ?? false)
          : false,
      });
      setUpdatedAt(payload.settings.updatedAt ?? null);
      setCapabilities(payload.capabilities);
      setLoadedOnce(true);

      if (payload.capabilities.telegramDeliveryConfigured) {
        void loadTelegramTargets();
      } else {
        setTelegramTargets([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alert contacts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loading || loadedOnce) return;
    void loadSettings();
  }, [loadedOnce, loading]);

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/config/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailRecipients: normalizeDraft(draft.emailRecipients),
          telegramChatIds: normalizeDraft(draft.telegramChatIds),
          phoneNumbers: normalizeDraft(draft.phoneNumbers),
          emailEnabled: draft.emailEnabled,
          telegramEnabled: draft.telegramEnabled,
          phoneEnabled: capabilities.phoneDeliveryConfigured ? draft.phoneEnabled : false,
        }),
      });
      const payload = await readJsonResponse<AlertSettingsPayload>(
        response,
        'Failed to save alert contacts.',
      );
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Failed to save alert contacts.'));
      }

      setDraft({
        emailRecipients: padContacts(payload.settings.emailRecipients ?? []),
        telegramChatIds: padContacts(payload.settings.telegramChatIds ?? []),
        phoneNumbers: padContacts(payload.settings.phoneNumbers ?? []),
        emailEnabled: payload.settings.emailEnabled ?? true,
        telegramEnabled: payload.settings.telegramEnabled ?? true,
        phoneEnabled: payload.capabilities.phoneDeliveryConfigured
          ? (payload.settings.phoneEnabled ?? false)
          : false,
      });
      setUpdatedAt(payload.settings.updatedAt ?? new Date().toISOString());
      setCapabilities(payload.capabilities);
      setNotice('Saved. These contacts now apply to alerts from every node in this account.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save alert contacts.');
    } finally {
      setSaving(false);
    }
  };

  const addTelegramTarget = (chatId: string) => {
    setDraft((current) => {
      if (current.telegramChatIds.includes(chatId)) {
        return current;
      }

      const next = [...current.telegramChatIds];
      const firstEmptyIndex = next.findIndex((entry) => !entry.trim());
      if (firstEmptyIndex >= 0) {
        next[firstEmptyIndex] = chatId;
      } else {
        next[0] = chatId;
      }

      return {
        ...current,
        telegramChatIds: next.slice(0, 3),
      };
    });
  };

  const sectionSummary = `${summary.emails} email | ${summary.telegram} telegram | ${summary.phones} phone | last saved ${formatUpdatedAt(updatedAt)}`;

  return (
    <CollapsibleSection
      id="alert-contacts"
      label="Alert Contacts"
      badge="CONFIG"
      summary={sectionSummary}
      defaultOpen={false}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setError(null);
          setNotice(null);
        }
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.emails} email
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.telegram} telegram
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-[11px] font-medium text-slate-300">
            {summary.phones} phone
          </span>
          <span className="text-[11px] text-slate-500">Last saved {formatUpdatedAt(updatedAt)}</span>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
            Loading alert contacts...
          </div>
        ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Email Recipients</p>
                    <button
                      type="button"
                      onClick={() => updateToggle('emailEnabled', !draft.emailEnabled)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                        draft.emailEnabled
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {draft.emailEnabled ? 'Enabled' : 'Disabled'}
                    </button>
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
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Telegram Recipients</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => updateToggle('telegramEnabled', !draft.telegramEnabled)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                          draft.telegramEnabled
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-slate-700 text-slate-400'
                        }`}
                      >
                        {draft.telegramEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadTelegramTargets()}
                        disabled={discoveringTelegram || !capabilities.telegramDeliveryConfigured}
                        className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {discoveringTelegram ? 'Refreshing...' : 'Refresh'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {draft.telegramChatIds.map((value, index) => (
                      <input
                        key={`telegram-${index}`}
                        type="text"
                        value={value}
                        onChange={(event) => updateField('telegramChatIds', index, event.target.value)}
                        placeholder={`Telegram ${index + 1}`}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                      />
                    ))}
                  </div>

                  {telegramTargets.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="space-y-2">
                        {telegramTargets.map((target) => (
                          <button
                            key={target.chatId}
                            type="button"
                            onClick={() => addTelegramTarget(target.chatId)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-left transition-colors hover:border-teal-500"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-100">{target.title}</p>
                              <p className="truncate text-[11px] text-slate-500">{target.subtitle}</p>
                            </div>
                            <span className="shrink-0 rounded-full border border-teal-500/40 px-2 py-1 text-[11px] text-teal-200">
                              Add
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">Phone Contacts</p>
                    <button
                      type="button"
                      onClick={() => updateToggle('phoneEnabled', !draft.phoneEnabled)}
                      disabled={!capabilities.phoneDeliveryConfigured}
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                        !capabilities.phoneDeliveryConfigured
                          ? 'cursor-not-allowed border-slate-800 text-slate-600'
                          : draft.phoneEnabled
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                          : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {capabilities.phoneDeliveryConfigured
                        ? (draft.phoneEnabled ? 'Enabled' : 'Disabled')
                        : 'Unavailable'}
                    </button>
                  </div>
                  {!capabilities.phoneDeliveryConfigured && (
                    <p className="mb-3 text-[11px] text-slate-500">
                      SMS delivery is not wired on this server yet, so no texts will be sent from these contacts.
                    </p>
                  )}
                  <div className="space-y-2">
                    {draft.phoneNumbers.map((value, index) => (
                      <input
                        key={`phone-${index}`}
                        type="tel"
                        value={value}
                        onChange={(event) => updateField('phoneNumbers', index, event.target.value)}
                        placeholder={`Phone ${index + 1}`}
                        disabled={!capabilities.phoneDeliveryConfigured}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-teal-500"
                      />
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={saving}
                className="w-full rounded-xl border border-yellow-600/60 bg-yellow-500/15 px-4 py-2 text-sm font-semibold text-yellow-100 transition-colors hover:border-yellow-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Apply alert contacts'}
              </button>
            </>
          )}

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
    </CollapsibleSection>
  );
}
