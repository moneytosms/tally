// Generated initials on a squircle. No image upload, no storage, no gravatar.

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

export function Avatar({ name, size = 29 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-[6px] border text-[12px] font-semibold"
      // One neutral tone. Moss and clay mean owed and owe in this app, so an
      // avatar tinted by name hash would put a false balance signal beside every amount.
      style={{
        width: size,
        height: size,
        borderColor: "var(--line)",
        background: "var(--paper-sunk)",
        color: "var(--ink-2)",
      }}
    >
      {initials(name)}
    </span>
  );
}
