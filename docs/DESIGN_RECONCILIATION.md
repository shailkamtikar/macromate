# Design token reconciliation — Stitch export

The Stitch export (`design/stitch_macromate_design_system_ui.zip`) contains two
disagreeing descriptions of the same design system:

1. `macromate/DESIGN.md` — has both a machine-readable YAML frontmatter (a
   Material-Design-3-style token set: `surface`, `on-surface-variant`,
   `primary-container`, etc., all fairly desaturated/green-grey) **and** a
   prose "Colors" section describing a different, more editorial palette
   (`#FBFBFA` canvas, `#18181B` text, indigo/amber/rose/sky macro colors).
2. The four `today_*` HTML exports implement the YAML frontmatter's token
   names via an inline Tailwind config, but assign macro colors
   inconsistently even against that: Protein uses `bg-primary-container`
   (green), Fat uses `bg-tertiary` (violet-ish `#453bdc`) — neither matches
   the prose's "indigo for protein / rose for fat" semantic intent.

**Decision:** the prose "Colors" section's *semantic* macro-color mapping
(Protein = indigo, Carbs = amber, Fat = rose, Water = sky, Calories/primary =
forest green) is adopted as source of truth, because:
- It is the more distinctive, on-brand palette described in the "Brand &
  Style" section ("Immediate Chromatic Parsing... dedicated hues to core
  metabolic metrics") — the actual design intent, not an implementation slip.
- The shipped HTML's macro-color choices look like a build-time mistake
  (e.g. fat rendered in a violet meant for a "tertiary" catch-all, not a
  deliberate rose choice) rather than a considered revision of the prose.
- Per project decision, generic/AI-SaaS visual patterns are explicitly to be
  avoided — the desaturated MD3 token set reads closer to a generic Material
  starting point than the warm, editorial system the prose describes.

For neutral tokens (surface/background/border/elevation), the YAML
frontmatter + shipped HTML are used as-is (they agree with each other and
with the prose's structural intent — warm porcelain light ground, deep
charcoal/zinc dark ground), since only the macro-color mapping conflicted.

## Resulting token set (`frontend/src/app/globals.css`)

| Token | Light | Dark | Source |
|---|---|---|---|
| `--color-surface` | `#fbf8fc` | `#0f1115` | YAML + prose (structural agreement) |
| `--color-surface-container-lowest` (cards) | `#ffffff` | `#181b20` | YAML + prose |
| `--color-on-surface` | `#1b1b1e` | `#f4f4f5` | YAML + prose |
| `--color-on-surface-variant` | `#3f493f` | `#a1a1aa` | YAML light / prose dark (YAML had no dark value) |
| `--color-primary` (calories/primary action) | `#15803d` | `#22c55e` | prose (forest green, matches brand copy) |
| `--color-protein` | `#4f46e5` | `#818cf8` | prose (indigo) — **overrides** shipped HTML's green |
| `--color-carbs` | `#d97706` | `#fbbf24` | prose (amber) — matches shipped HTML |
| `--color-fat` | `#e11d48` | `#fb7185` | prose (rose) — **overrides** shipped HTML's violet |
| `--color-water` | `#0284c7` | `#38bdf8` | prose + shipped HTML (agree) |
| Type scale, spacing, radii, elevation | as documented | as documented | YAML frontmatter (both sources agreed) |

This file is the reference for any future Stitch re-export: if new screens
ship with the shipped-HTML macro-color pattern again, treat it as the same
known inconsistency, not a new design decision.
