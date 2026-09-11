// MacroMate service worker -- deliberately small scope:
//   1. Cache the app shell/static assets so a repeat visit and a brief
//      offline moment don't show a broken browser error page.
//   2. Serve a calm offline fallback for navigations when there's truly no
//      network and nothing cached for that route yet.
//   3. Show a notification when asked to by the page (NotificationPoller),
//      via showNotification() -- this is a *local*, tab-open notification,
//      not remote/server push. There is no `push` event handler here
//      because there is no push subscription/server to send one (see
//      backend/app/core/fcm.py for exactly what's missing for real push).
//
// It NEVER intercepts anything other than same-origin GET requests for the
// small static-shell allowlist below -- API calls (this app's backend, a
// different origin) and Supabase auth/data calls are always left to the
// network untouched, so no authenticated/private response is ever written
// into this (unauthenticated, shared-by-origin) cache.

const CACHE_NAME = "macromate-shell-v1";
const OFFLINE_URL = "/offline.html";
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever handle same-origin GET requests -- this is what keeps the
  // backend API and Supabase (both different origins) completely outside
  // this service worker's reach.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Page navigations: try the network first (so a signed-in user always
  // sees live content when online), fall back to a cached shell page, then
  // the offline fallback -- never a raw browser network-error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)),
      ),
    );
    return;
  }

  // Static shell assets only: cache-first, since these are fingerprinted
  // or rarely-changing brand assets, not data.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});

// Local notification display, requested by the page (see
// NotificationPoller.tsx) -- not a push event, just a same-tab-open way to
// get a real OS-level notification instead of only an in-app banner.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "SHOW_NOTIFICATION") return;
  const { title, body, tag, url } = event.data;
  self.registration.showNotification(title, {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/today";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
