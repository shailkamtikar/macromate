"use client";

import { useId, useState } from "react";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
}

/** A password input with a visibility toggle -- shared by login and
 * signup so both get the same accessible label wiring and behavior. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-on-surface-variant">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          required
          autoComplete={autoComplete}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input w-full pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Deliberately doesn't contain the word "password" -- Playwright's
          // (and other testing-library-style) getByLabel/getByRole name
          // matching is substring-based, and an aria-label containing
          // "password" here collides with every test's
          // getByLabel("Password") for the input itself. "Show/Hide
          // characters" stays clear given the adjacent password field.
          aria-label={visible ? "Hide characters" : "Show characters"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-on-surface-variant hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            {visible ? "visibility_off" : "visibility"}
          </span>
        </button>
      </div>
    </div>
  );
}
