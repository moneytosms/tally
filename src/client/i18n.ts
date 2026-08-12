// Plain t() over locales/<lang>.json + native Intl.PluralRules. No framework.
// English only for now, but EVERY user-facing string goes through here from line one -
// retrofitting the extraction later is the expensive path.
// ?raw avoids needing resolveJsonModule in tsconfig; Vite types the import as a string.
import enRaw from "../../locales/en.json?raw";

const dict = JSON.parse(enRaw) as Record<string, unknown>;
const pluralRules = new Intl.PluralRules("en");

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) return (node as Record<string, unknown>)[part];
    return undefined;
  }, dict);
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let value = lookup(key);
  if (value && typeof value === "object" && typeof vars?.count === "number") {
    const category = pluralRules.select(vars.count);
    const forms = value as Record<string, string>;
    value = forms[category] ?? forms.other;
  }
  if (typeof value !== "string") {
    if (import.meta.env.DEV) console.warn(`t(): missing key "${key}"`);
    return key;
  }
  return interpolate(value, vars);
}
