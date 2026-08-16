import { useState } from "react";
import { Select } from "~/client/components/ui";
import { t } from "~/client/i18n";
import { DARK_THEMES, getTheme, LIGHT_THEMES, setTheme, type Theme } from "~/client/lib/theme";

const LABEL: Record<Theme, string> = {
  system: "profile.themeSystem",
  paper: "profile.themePaper",
  sakura: "profile.themeSakura",
  ocean: "profile.themeOcean",
  dark: "profile.themeDark",
  midnight: "profile.themeMidnight",
  ember: "profile.themeEmber",
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

  return (
    <div className="rounded-[7px] border px-3.5 py-3.5" style={{ background: "var(--paper-2)", borderColor: "var(--line)" }}>
      <div className="flex items-center gap-3">
        {/* A native <select> cannot render a swatch per option, so the preview
            sits beside it and follows the selection. */}
        <Swatch theme={theme} />
        <Select
          aria-label={t("profile.theme")}
          value={theme}
          onChange={(e) => {
            const next = e.target.value as Theme;
            setTheme(next);
            setCurrent(next);
          }}
        >
          <option value="system">{t(LABEL.system)}</option>
          <optgroup label={t("profile.themeLight")}>
            {LIGHT_THEMES.map((id) => (
              <option key={id} value={id}>
                {t(LABEL[id])}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("profile.themeDarkGroup")}>
            {DARK_THEMES.map((id) => (
              <option key={id} value={id}>
                {t(LABEL[id])}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
        {t("profile.themeHint")}
      </p>
    </div>
  );
}
