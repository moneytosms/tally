// Generated initials on a squircle. No image upload, no storage, no gravatar.

const tones = [
  { background: "var(--moss-wash)", color: "var(--moss-2)" },
  { background: "var(--clay-wash)", color: "var(--clay)" },
  { background: "var(--moss-wash)", color: "var(--ochre)" },
];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

export function Avatar({ name, size = 29 }: { name: string; size?: number }) {
  // Stable per name so the same person keeps the same tone across screens.
  const tone = tones[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length]!;
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-[6px] border text-[11.5px] font-semibold"
      style={{ width: size, height: size, borderColor: "var(--line)", ...tone }}
    >
      {initials(name)}
    </span>
  );
}
