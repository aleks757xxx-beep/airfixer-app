import { useEffect, useState } from "react";
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from "../lib/theme";

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; icon: string }> = [
  { value: "light", label: "Светлая тема", icon: "☀️" },
  { value: "system", label: "Как в системе", icon: "🖥️" },
  { value: "dark", label: "Тёмная тема", icon: "🌙" },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div role="radiogroup" aria-label="Тема" className="flex rounded-full border border-slate-200 p-0.5 dark:border-white/15">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          title={o.label}
          onClick={() => setTheme(o.value)}
          className={`rounded-full px-2 py-1 text-sm ${theme === o.value ? "bg-slate-200 dark:bg-white/15" : ""}`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
