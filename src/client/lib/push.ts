// Browser-side Web Push enrolment.
//
// SPEC §10: "iOS Web Push requires an installed PWA. Say so where notifications
// are enabled rather than failing silently." Every failure mode below returns a
// named reason so the UI can explain itself instead of showing a dead switch.
import { api } from "./api";

export type PushState =
  | { status: "on"; endpoint: string }
  | { status: "off" }
  | { status: "unsupported" }
  | { status: "denied" }
  /** iOS: the APIs exist but only work from a Home Screen install. */
  | { status: "needs-install" }
  /** No VAPID key on this instance — push was never provisioned. */
  | { status: "unavailable" };

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** base64url VAPID key → the Uint8Array `subscribe()` insists on. */
function keyToBytes(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function currentPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? { status: "needs-install" } : { status: "unsupported" };
  if (Notification.permission === "denied") return { status: "denied" };

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? { status: "on", endpoint: sub.endpoint } : { status: "off" };
}

/**
 * Ask for permission, subscribe, and register the subscription with the server.
 *
 * The server call happens LAST and its failure unsubscribes again, so the
 * browser and the database never disagree about whether this device is enrolled
 * — a subscription the server does not know about is a device that silently
 * never gets notified.
 */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? { status: "needs-install" } : { status: "unsupported" };

  const { publicKey } = await api<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return { status: "unavailable" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(publicKey) as BufferSource,
    }));

  const json = sub.toJSON();
  try {
    await api("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
    });
  } catch (e) {
    await sub.unsubscribe();
    throw e;
  }
  return { status: "on", endpoint: sub.endpoint };
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { status: "off" };

  // Tell the server first: if unsubscribing succeeds but the server call fails,
  // it would keep pushing to a dead endpoint until the service returns 410.
  await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(
    () => undefined,
  );
  await sub.unsubscribe();
  return { status: "off" };
}

export const pushNeedsInstall = () => isIos() && !isStandalone();
