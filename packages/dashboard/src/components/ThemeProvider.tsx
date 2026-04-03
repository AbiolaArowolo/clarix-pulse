import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'midnight' | 'carbon' | 'storm' | 'light' | 'system';
export type ColorMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'clarix-theme';
const THEME_CYCLE: Theme[] = ['midnight', 'carbon', 'storm', 'light', 'system'];

const THEME_LABELS: Record<Theme, string> = {
  midnight: 'Midnight',
  carbon: 'Carbon',
  storm: 'Storm',
  light: 'Daylight',
  system: 'Auto',
};

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored && THEME_CYCLE.includes(stored)) return stored;
  } catch {
    // ignore
  }
  return 'midnight';
}

function getSystemColorMode(): ColorMode {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

function resolveDataTheme(theme: Theme): Exclude<Theme, 'system'> {
  if (theme !== 'system') return theme;
  return getSystemColorMode() === 'dark' ? 'midnight' : 'light';
}

function resolveColorMode(theme: Theme): ColorMode {
  if (theme === 'light') return 'light';
  if (theme === 'system') return getSystemColorMode();
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', resolveDataTheme(theme));
}

interface ThemeContextValue {
  theme: Theme;
  colorMode: ColorMode;
  themeLabel: string;
  cycleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'midnight',
  colorMode: 'dark',
  themeLabel: 'Midnight',
  cycleTheme: () => undefined,
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = readStoredTheme();
    applyTheme(initial);
    return initial;
  });

  const [colorMode, setColorMode] = useState<ColorMode>(() => resolveColorMode(readStoredTheme()));

  useEffect(() => {
    applyTheme(theme);
    setColorMode(resolveColorMode(theme));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }

    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      applyTheme('system');
      setColorMode(resolveColorMode('system'));
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const idx = THEME_CYCLE.indexOf(current);
      return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, colorMode, themeLabel: THEME_LABELS[theme], cycleTheme, setTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
