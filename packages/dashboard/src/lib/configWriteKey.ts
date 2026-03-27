const CONFIG_WRITE_KEY_STORAGE = 'pulse.config_write_key';

export function readStoredConfigWriteKey(): string {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(CONFIG_WRITE_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function storeConfigWriteKey(value: string) {
  if (typeof window === 'undefined') return;

  try {
    if (value) {
      window.localStorage.setItem(CONFIG_WRITE_KEY_STORAGE, value);
    } else {
      window.localStorage.removeItem(CONFIG_WRITE_KEY_STORAGE);
    }
  } catch {
    // Ignore storage failures.
  }
}
