import type { ReactNode } from "react";

/** Empty states carry the teaching (SPEC §10). Body is a sentence, not a shrug. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[7px] border px-5 py-8 text-center" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      <p className="serif text-[17px]" style={{ color: "var(--ink)" }}>
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-[36ch] text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {body}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
