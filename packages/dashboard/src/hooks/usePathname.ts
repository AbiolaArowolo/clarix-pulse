import { useEffect, useState } from 'react';

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  if (pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function navigate(pathname: string, replace = false) {
  const nextPath = normalizePathname(pathname);
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', nextPath);
  window.dispatchEvent(new Event('pulse:navigate'));
}

export function usePathname() {
  const [pathname, setPathname] = useState(() => normalizePathname(window.location.pathname));

  useEffect(() => {
    const update = () => setPathname(normalizePathname(window.location.pathname));
    window.addEventListener('popstate', update);
    window.addEventListener('pulse:navigate', update);

    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('pulse:navigate', update);
    };
  }, []);

  return pathname;
}
