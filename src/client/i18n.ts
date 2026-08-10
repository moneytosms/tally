// Plain t() over locales/<lang>.json + native Intl.PluralRules. No framework.
// English only for now, but EVERY user-facing string goes through here from line one —
// retrofitting the extraction later is the expensive path.
export function t(_key: string, _vars?: Record<string, string | number>): string {
  throw new Error("TODO");
}
