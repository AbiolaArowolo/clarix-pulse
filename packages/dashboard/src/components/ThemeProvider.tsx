import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'midnight' | 'carbon' | 'storm';

const THEME_STORAGE_KEY = 'clarix-theme';
const THEME_CYCLE: Theme[] = ['midnight', 'carbon', 'storm'];

const THEME_LABELS: Record<Theme, string> = {
  midnight: 'Midnight',
  carbon: 'Carbon',
  storm: 'Storm',
};

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'midnight' || stored === 'carbon' || stored === 'storm') {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'midnight';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeContextValue {
  theme: Theme;
  themeLabel: string;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'midnight',
  themeLabel: 'Midnight',
  cycleTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = readStoredTheme();
    applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      const currentIndex = THEME_CYCLE.indexOf(current);
      const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
      return THEME_CYCLE[nextIndex];
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themeLabel: THEME_LABELS[theme], cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
