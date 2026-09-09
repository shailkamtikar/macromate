"use client";

import { useEffect, useRef, useState } from "react";

interface NumericFieldProps {
  id?: string;
  value: number;
  onCommit: (value: number) => void;
  /** Optional: fires on every keystroke that parses to a valid number
   * (before clamping/blur), for UI that needs to react live — e.g.
   * recalculating targets as the user types a calorie override. Omit for
   * fields that only need a final value once the user leaves the field. */
  onLiveChange?: (value: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * A numeric input whose on-screen text is its own state, decoupled from the
 * committed numeric value — the classic `<input type="number" value={n}
 * onChange={e => setN(Number(e.target.value))}>` pattern fights the user:
 * clearing the field makes `Number("")` become 0, which the controlled
 * value then redisplays as an unwanted "0", and re-deriving the DOM value
 * from a coerced number on every keystroke can visibly reformat what was
 * just typed. Here the displayed text tracks keystrokes verbatim (digits
 * and at most one decimal point, nothing else — no grouping, no
 * reformatting) and clamping/validation only happens on blur.
 */
export function NumericField({
  id,
  value,
  onCommit,
  onLiveChange,
  min,
  max,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: NumericFieldProps) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText((prev) => (value === 0 && prev === "" ? prev : String(value)));
  }, [value]);

  function parse(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === ".") return null;
    const n = Number(trimmed);
    return Number.isNaN(n) ? null : n;
  }

  function commit() {
    focused.current = false;
    const parsed = parse(text);
    if (parsed === null) {
      onCommit(0);
      return;
    }
    let clamped = parsed;
    if (min !== undefined) clamped = Math.max(clamped, min);
    if (max !== undefined) clamped = Math.min(clamped, max);
    if (clamped !== parsed) setText(String(clamped));
    onCommit(clamped);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      placeholder={placeholder}
      className={className}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "" || /^-?\d*\.?\d*$/.test(next)) {
          setText(next);
          const parsed = parse(next);
          if (parsed !== null) onLiveChange?.(parsed);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
