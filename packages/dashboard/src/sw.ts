/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

// Keep SPA deep links alive inside the installed PWA so /app and its child
// routes resolve to the app shell instead of blanking on direct open/refresh.
const navigationHandler = createHandlerBoundToURL('/index.html');
registerRoute(new NavigationRoute(navigationHandler, {
  denylist: [
    /^\/api(?:\/|$)/,
    /^\/socket\.io(?:\/|$)/,
    /\/[^/?]+\.[^/]+$/,
  ],
}));

// Push notification handler
self.addEventListener('push', (event: PushEvent) => {
  let title = 'Clarix Pulse';
  let body = 'An alert was received.';
  let tag = 'pulse-alert';

  try {
    const data = event.data?.json() as { title?: string; body?: string; tag?: string } | undefined;
    if (data?.title) title = data.title;
    if (data?.body) body = data.body;
    if (data?.tag) tag = data.tag;
  } catch {
    // ignore parse error — use defaults
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pulse-icon-192.png',
      badge: '/pulse-icon-192.png',
      tag,
      data: { url: '/app' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? '/app';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/app') && 'focus' in client) {
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
