"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "@/lib/theme";

type ThemeChoice = "light" | "dark" | "system";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function applyTheme(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.cookie = `${THEME_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Private-browsing / storage-blocked — theme just won't persist.
    }
  } else {
    document.documentElement.setAttribute("data-theme", choice);
    // The cookie is what makes the *next* server render already agree with
    // this choice (see layout.tsx) — localStorage alone can't do that,
    // since the server can't read it.
    document.cookie = `${THEME_COOKIE_NAME}=${choice}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Same as above — the toggle still works for this page load.
    }
  }
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a synchronous local API, not fetched data
      if (stored === "dark" || stored === "light") setChoice(stored);
    } catch {
      // Leave default "system".
    }
  }, []);

  function handleChange(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div className="flex gap-2">
      {(["light", "system", "dark"] as ThemeChoice[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => handleChange(option)}
          className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold capitalize ${
            choice === option
              ? "bg-primary text-on-primary"
              : "bg-surface-container text-on-surface-variant"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
