import React, { useEffect, useState } from 'react';

interface Props {
  id: string;
  label: string;
  badge?: string;
  summary?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function readStoredOpen(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === '1';
  } catch {
    return fallback;
  }
}

function writeStoredOpen(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

export function CollapsibleSection({ id, label, badge, summary, defaultOpen = true, forceOpen, onOpenChange, children }: Props) {
  const storageKey = `clarix-pulse-section-${id}`;
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen));

  useEffect(() => {
    writeStoredOpen(storageKey, open);
  }, [open, storageKey]);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/58 shadow-[0_20px_60px_rgba(2,6,23,0.28)] backdrop-blur">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`collapsible-body-${id}`}
        className="flex w-full cursor-pointer items-center gap-3 border-l-2 border-cyan-500/40 bg-white/[0.03] px-4 py-4 text-left transition-colors hover:bg-white/[0.06] sm:px-6"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : 'rotate-0'}`}
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{label}</span>
            {badge && (
              <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2 py-0.5 text-xs font-mono uppercase tracking-wider text-slate-400">
                {badge}
              </span>
            )}
          </span>
          {!open && summary && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>
          )}
        </span>
      </button>

      <div
        id={`collapsible-body-${id}`}
        className={`grid transition-all duration-200 ease-in-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="p-4 sm:p-6">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
