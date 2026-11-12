import { useId, useRef } from "react";
import { t } from "~/client/i18n";
import { focusRing } from "./focus";
import { Icon } from "./Icon";

/** Always-visible search. Clear appears only when there is text, and returns focus to the field. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        style={{ color: "var(--ink-3)" }}
      >
        <Icon name="search" />
      </span>
      <input
        ref={input}
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-11 w-full rounded-[6px] border pl-10 text-[16px] [&::-webkit-search-cancel-button]:appearance-none ${
          value ? "pr-11" : "pr-3"
        } ${focusRing}`}
        style={{ background: "var(--paper-sunk)", borderColor: "var(--line-2)", color: "var(--ink)" }}
      />
      {value && (
        <button
          type="button"
          aria-label={t("action.clearSearch")}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className={`absolute top-0 right-0 grid min-h-11 min-w-11 place-items-center rounded-[6px] hover:bg-[var(--paper-sunk)] ${focusRing}`}
          style={{ color: "var(--ink-2)" }}
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  );
}
