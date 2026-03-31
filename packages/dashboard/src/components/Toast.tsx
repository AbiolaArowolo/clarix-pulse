import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (message: string, type: ToastType) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => undefined,
  removeToast: () => undefined,
});

let nextId = 1;
const DISMISS_DURATION_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, type }]);
    setTimeout(() => removeToast(id), DISMISS_DURATION_MS);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const { addToast } = useContext(ToastContext);
  return {
    success: (message: string) => addToast(message, 'success'),
    error: (message: string) => addToast(message, 'error'),
    info: (message: string) => addToast(message, 'info'),
  };
}

const typeStyles: Record<ToastType, string> = {
  success: 'border-emerald-500/50 bg-emerald-900/80 text-emerald-100',
  error: 'border-red-500/50 bg-red-900/80 text-red-100',
  info: 'border-cyan-500/40 bg-cyan-900/70 text-cyan-100',
};

const typeDotStyles: Record<ToastType, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  info: 'bg-cyan-400',
};

interface ToastItemProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

function ToastEntry({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(enter);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      } ${typeStyles[toast.type]}`}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${typeDotStyles[toast.type]}`} />
      <span className="flex-1 leading-5">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="ml-1 shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastEntry toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
