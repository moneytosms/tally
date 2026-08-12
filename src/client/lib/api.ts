// One fetch wrapper for /api. Same-origin, JSON in, JSON out.
// Never cached by a service worker - a stale balance is worse than no balance.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Writes offline fail immediately and visibly. No queue, no outbox, no retry.
  const method = init?.method ?? "GET";
  if (method !== "GET" && typeof navigator !== "undefined" && !navigator.onLine) {
    throw new ApiError(0, "offline", "offline");
  }

  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json", ...init?.headers },
  });

  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as { error?: string; code?: string } | null;
    throw new ApiError(res.status, err?.error ?? res.statusText, err?.code);
  }
  return body as T;
}
