"use client";

import { useState } from "react";
import { logWeight } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { NumericField } from "@/components/NumericField";

/** One-tap weight entry for the Progress page. The server validates the value
 * and writes the log; the chart above refreshes through `onLogged`. */
export function WeightQuickLog({ onLogged }: { onLogged: () => void }) {
  const [kg, setKg] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(kg > 0)) {
      setError("Enter your weight in kg.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await logWeight(kg);
      setNotice(`Logged ${kg} kg.`);
      onLogged();
    } catch (err) {
      setError(friendlyMessage(err, "profile-save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-4" data-testid="weight-quick-log">
      <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
        <span className="eyebrow">Log today&apos;s weight</span>
        <NumericField
          min={1}
          max={400}
          value={kg}
          onLiveChange={setKg}
          onCommit={setKg}
          className="input w-32"
          aria-label="Weight in kilograms"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-transform active:scale-95 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Log weight"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-fat">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="w-full text-sm text-primary">
          {notice}
        </p>
      )}
    </form>
  );
}
