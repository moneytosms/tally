import { useState } from "react";
import { focusRing } from "~/client/components/ui/focus";
import { t } from "~/client/i18n";
import { getTheme, setTheme, THEMES, type Theme } from "~/client/lib/theme";

const LABEL: Record<Theme, string> = {
  system: "profile.themeSystem",
  paper: "profile.themePaper",
  dark: "profile.themeDark",
  sakura: "profile.themeSakura",
  ocean: "profile.themeOcean",
  midnight: "profile.themeMidnight",
};

// The swatch carries the theme's own data-theme, so the dots read that palette's
// tokens straight from the cascade instead of duplicating hexes here. "system"
// carries none, which is exactly how it resolves on <html>.
function Swatch({ theme }: { theme: Theme }) {
  return (
    <span aria-hidden className="flex flex-none gap-1" data-theme={theme === "system" ? undefined : theme}>
      <span className="size-3.5 rounded-full border" style={{ background: "var(--paper)", borderColor: "var(--line-2)" }} />
      <span className="size-3.5 rounded-full" style={{ background: "var(--moss)" }} />
      <span className="size-3.5 rounded-full" style={{ background: "var(--clay)" }} />
    </span>
  );
}

export function ThemePicker() {
  const [theme, setCurrent] = useState<Theme>(getTheme);

  function choose(next: Theme) {
    setTheme(next);
    setCurrent(next);
  }

  return (
    <div className="rounded-[7px] border px-3.5 py-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      <div role="radiogroup" aria-label={t("profile.theme")}>
        {THEMES.map((id) => (
          <label key={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-[13px]">
            <input
              type="radio"
              name="tally-theme"
              value={id}
              checked={theme === id}
              onChange={() => choose(id)}
              className={`size-4 flex-none ${focusRing}`}
              style={{ accentColor: "var(--moss)" }}
            />
            <Swatch theme={id} />
            <span>{t(LABEL[id])}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("profile.themeHint")}
      </p>
    </div>
  );
}
