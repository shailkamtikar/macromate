"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "light" | "dark" | "system";

function applyTheme(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.removeItem("macromate-theme");
    } catch {
      // Private-browsing / storage-blocked — theme just won't persist.
    }
  } else {
    document.documentElement.setAttribute("data-theme", choice);
    try {
      localStorage.setItem("macromate-theme", choice);
    } catch {
      // Same as above — the toggle still works for this page load.
    }
  }
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("macromate-theme");
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
