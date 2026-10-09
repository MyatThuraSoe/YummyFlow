/* eslint-disable no-undef */
/**
 * DineFlow service worker (PRO — browser push notifications).
 *
 * Served from /sw.js by Vite's public/ directory. Deliberately dependency-free:
 * a service worker must be able to install even when the app bundle is broken.
 */

const CACHE = "dineflow-sw-v1";

self.addEventListener("install", (event) => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous SW versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/**
 * Payload shape sent by backend/src/lib/push.ts:
 *   { title, body, url, tag }
 */
self.addEventListener("push", (event) => {
  let data = {
    title: "DineFlow",
    body: "You have a new notification.",
    url: "/dashboard",
    tag: "dineflow",
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    // Non-JSON payload — fall back to plain text.
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch {
      /* keep defaults */
    }
  }

  const options = {
    body: data.body,
    tag: data.tag,
    // Re-notify even if a notification with the same tag is visible.
    renotify: Boolean(data.tag),
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/dashboard" },
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

/** Focus an existing tab when possible, otherwise open a new one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = event.notification.data?.url || "/dashboard";
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        // Same-origin tab already open -> focus it and route it.
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* some browsers disallow cross-document navigate from SW */
            }
          }
          return;
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});

/** Allow the page to trigger a notification for local testing. */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
