"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, THEME_STORAGE_KEY } from "@/lib/theme";

type ThemeChoice = "light" | "dark" | "system";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Dark is the default; the choice (including "system") is stored in a
 * cookie, which is what lets the *server* render the right theme on the next
 * request (see layout.tsx) -- localStorage alone can't do that. */
function applyTheme(choice: ThemeChoice) {
  document.documentElement.setAttribute("data-theme", choice);
  document.cookie = `${THEME_COOKIE_NAME}=${choice}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private-browsing / storage-blocked: the toggle still works for this page load.
  }
}

function currentTheme(): ThemeChoice {
  const attr = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
  return attr === "light" || attr === "system" ? attr : "dark";
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("dark");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the attribute the server already rendered
    setChoice(currentTheme());
  }, []);

  function handleChange(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div className="flex gap-2" role="group" aria-label="Theme">
      {(["dark", "light", "system"] as ThemeChoice[]).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => handleChange(option)}
          aria-pressed={choice === option}
          className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold capitalize transition-colors ${
            choice === option
              ? "bg-primary text-on-primary"
              : "bg-surface-container text-on-surface-variant hover:text-on-surface"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
