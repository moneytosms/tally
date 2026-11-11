/* global self, URL */
// Pulled into the generated service worker via workbox.importScripts: generateSW
// emits no push handler, so without this a received push is silently dropped.
// Deliberately no fetch handler and no caching: API responses must never be cached.

const DEFAULT_TITLE = "tally";

self.addEventListener("push", (event) => {
  let msg;
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = {};
  }
  const title = typeof msg.title === "string" && msg.title ? msg.title : DEFAULT_TITLE;
  const body = typeof msg.body === "string" ? msg.body : "";
  // userVisibleOnly: every push must show something, so this always calls showNotification.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: safePath(msg.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const win = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        if (win.navigate) await win.navigate(url);
        return win.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Same-origin paths only: anything that resolves elsewhere becomes "/".
function safePath(raw) {
  try {
    const u = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}
