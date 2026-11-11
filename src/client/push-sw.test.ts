// @ts-expect-error node:fs is untyped here - @types/node is not a dependency
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type Notes = { body: string; data: { url: string } };
type Handler = (event: Record<string, unknown>) => void;

// public/push-sw.js is a classic script with no imports, so evaluate it against a fake `self`.
function load() {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn((_title: string, _opts: Notes) => Promise.resolve());
  const openWindow = vi.fn((_url: string) => Promise.resolve());
  const matchAll = vi.fn(() => Promise.resolve([]));
  const self = {
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    registration: { showNotification },
    location: { origin: "https://tally.example" },
    clients: { matchAll, openWindow },
  };
  const source = readFileSync(new URL("../../public/push-sw.js", import.meta.url), "utf8");
  new Function("self", source)(self);
  return { handlers, showNotification, openWindow, matchAll };
}

function pushEvent(data?: string) {
  const waits: Promise<unknown>[] = [];
  const event = {
    data: data === undefined ? undefined : { json: () => JSON.parse(data) },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  };
  return { event, waits };
}

function clickEvent(url: unknown) {
  const waits: Promise<unknown>[] = [];
  const close = vi.fn();
  const event = {
    notification: { close, data: { url } },
    waitUntil: (p: Promise<unknown>) => waits.push(p),
  };
  return { event, waits, close };
}

describe("push-sw", () => {
  it("shows the payload title, body and url on push", async () => {
    const { handlers, showNotification } = load();
    const { event, waits } = pushEvent(
      JSON.stringify({ title: "Ana settled", body: "₹500 in Goa", url: "/ledgers/1" }),
    );
    handlers.push!(event);
    await Promise.all(waits);
    expect(showNotification).toHaveBeenCalledOnce();
    const [title, opts] = showNotification.mock.calls[0]!;
    expect(title).toBe("Ana settled");
    expect(opts.body).toBe("₹500 in Goa");
    expect(opts.data.url).toBe("/ledgers/1");
  });

  it("still shows a generic notification when the push has no data", async () => {
    const { handlers, showNotification } = load();
    const { event, waits } = pushEvent();
    handlers.push!(event);
    await Promise.all(waits);
    expect(showNotification).toHaveBeenCalledOnce();
    const [title, opts] = showNotification.mock.calls[0]!;
    expect(title).toBe("tally");
    expect(opts.body).toBe("");
  });

  it("opens the payload path when no window is open", async () => {
    const { handlers, openWindow, matchAll } = load();
    const { event, waits, close } = clickEvent("/ledgers/1");
    handlers.notificationclick!(event);
    await Promise.all(waits);
    expect(close).toHaveBeenCalled();
    expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(openWindow).toHaveBeenCalledWith("/ledgers/1");
  });

  it("opens / instead of a cross-origin url", async () => {
    const { handlers, openWindow } = load();
    const { event, waits } = clickEvent("https://evil.example/steal");
    handlers.notificationclick!(event);
    await Promise.all(waits);
    expect(openWindow).toHaveBeenCalledWith("/");
  });
});
