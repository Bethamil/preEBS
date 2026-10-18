"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "preebs:theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: Theme = stored === "dark" ? "dark" : "light";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-3 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-soft)] transition hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      onClick={() => {
        setTheme(nextTheme);
        applyTheme(nextTheme);
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span
        className="relative inline-flex h-4 w-8 items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel-strong)]"
        aria-hidden
      >
        <span
          className="absolute h-3 w-3 rounded-full bg-[var(--color-accent)] transition-transform"
          style={{ transform: theme === "dark" ? "translateX(16px)" : "translateX(2px)" }}
        />
      </span>
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
