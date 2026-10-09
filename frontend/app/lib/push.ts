/**
 * Browser push helpers (PRO).
 *
 * Everything here is browser-only and SSR-safe: every entry point returns a
 * degraded result instead of throwing when `navigator`/`serviceWorker` are
 * unavailable, so it can be imported from route modules that also render on
 * the server.
 */
import { customFetch } from "./api";

export type PushSupport = {
  /** The browser implements the required APIs at all. */
  supported: boolean;
  /** Running on https:// or localhost — Web Push refuses anything else. */
  secureContext: boolean;
  permission: NotificationPermission | "unsupported";
  /** This device currently has an active push subscription. */
  subscribed: boolean;
  /** Server has VAPID keys configured. */
  serverEnabled: boolean;
  /** Human-readable reason when `supported` or `serverEnabled` is false. */
  reason?: string;
};

const SW_URL = "/sw.js";

const isBrowser = () =>
  typeof window !== "undefined" && typeof navigator !== "undefined";

export function pushSupported(): boolean {
  return (
    isBrowser() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID public keys are base64url; the Push API wants a Uint8Array. */
export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch (error) {
    console.error("[push] service worker registration failed:", error);
    return null;
  }
}

/** Ask the server for the VAPID key; fall back to the build-time env var. */
async function getVapidKey(): Promise<string | null> {
  try {
    const res = await customFetch<{ publicKey: string | null }>(
      "/notifications/public-key",
    );
    if (res?.publicKey) return res.publicKey;
  } catch {
    /* fall through to env */
  }
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY as string) || null;
}

/** Current state of push for this device + this server. */
export async function getPushState(): Promise<PushSupport> {
  const base: PushSupport = {
    supported: false,
    secureContext: false,
    permission: "unsupported",
    subscribed: false,
    serverEnabled: false,
  };

  if (!isBrowser()) return { ...base, reason: "Not running in a browser" };

  base.secureContext = window.isSecureContext;
  base.supported = pushSupported();
  base.permission = pushSupported() ? Notification.permission : "unsupported";

  try {
    const res = await customFetch<{ pushEnabled: boolean }>(
      "/notifications/status",
    );
    base.serverEnabled = Boolean(res?.pushEnabled);
  } catch {
    base.serverEnabled = false;
  }

  if (base.supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW_URL);
      const sub = await reg?.pushManager.getSubscription();
      base.subscribed = Boolean(sub);
    } catch {
      base.subscribed = false;
    }
  }

  if (!base.secureContext) base.reason = "Web Push requires https:// or localhost";
  else if (!base.supported) base.reason = "This browser does not support Web Push";
  else if (!base.serverEnabled) base.reason = "Server VAPID keys are not configured";

  return base;
}

export type SubscribeResult =
  | { ok: true; endpoint: string }
  | { ok: false; error: string };

/** Full subscribe flow: permission -> SW -> PushManager -> backend. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) {
    return { ok: false, error: "Push notifications are not supported here." };
  }
  if (!window.isSecureContext) {
    return { ok: false, error: "Web Push needs https:// or localhost." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notification permission was denied." };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { ok: false, error: "Service worker registration failed." };
  }

  // Wait for the SW to actually control the page, otherwise pushManager can be
  // unavailable on a very first load.
  await navigator.serviceWorker.ready;

  const vapidKey = await getVapidKey();
  if (!vapidKey) {
    return { ok: false, error: "Server did not provide a VAPID public key." };
  }

  try {
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const json = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };

    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: "Browser returned an incomplete subscription." };
    }

    await customFetch("/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });

    return { ok: true, endpoint: json.endpoint };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || "Failed to subscribe to push notifications.",
    };
  }
}

/** Unsubscribe locally and tell the backend to forget this device. */
export async function unsubscribeFromPush(): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, error: "Not supported here." };

  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL);
    const subscription = await registration?.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await customFetch("/notifications/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      });
      return { ok: true, endpoint };
    }

    // No local subscription but the server may still hold a stale row.
    await customFetch("/notifications/unsubscribe", {
      method: "POST",
      body: JSON.stringify({}),
    });
    return { ok: true, endpoint: "" };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || "Failed to unsubscribe.",
    };
  }
}

/** Fire a test push + email at the current user (settings panel button). */
export async function sendTestNotification() {
  return customFetch<{
    push: { enabled: boolean; sent: number; failed: number; skipped: boolean; hint?: string };
    email: { mode: string; ok: boolean; preview?: string; error?: string };
  }>("/notifications/test", { method: "POST", body: JSON.stringify({}) });
}
