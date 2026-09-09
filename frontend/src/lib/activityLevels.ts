import { ActivityLevel } from "@/lib/api";

// Labels intentionally differ from the wire values (which stay
// sedentary/light/moderate/active/very_active to avoid a data migration) —
// "active"/"very_active" are relabeled "Very active"/"Extra active" to
// match the standard 5-tier TDEE multiplier naming the multipliers
// themselves already follow (1.2 / 1.375 / 1.55 / 1.725 / 1.9).
export const ACTIVITY_LEVEL_INFO: Record<
  ActivityLevel,
  { label: string; description: string; example: string }
> = {
  sedentary: {
    label: "Sedentary",
    description: "Little to no exercise, mostly sitting through the day.",
    example:
      "Example: a desk job or remote work, no regular workouts — most of your day is spent sitting.",
  },
  light: {
    label: "Lightly active",
    description: "Light exercise or sports 1–3 days a week.",
    example:
      "Example: a few casual walks, some light cycling, or a yoga class once or twice a week.",
  },
  moderate: {
    label: "Moderately active",
    description: "Moderate exercise or sports 3–5 days a week.",
    example:
      "Example: regular gym sessions or playing a sport 3–5 times a week, on top of a normal desk job.",
  },
  active: {
    label: "Very active",
    description: "Hard exercise or sports 6–7 days a week.",
    example:
      "Example: intense training most days of the week — daily gym sessions or serious sports practice.",
  },
  very_active: {
    label: "Extra active",
    description: "Very hard daily training, or a physically demanding job plus regular exercise.",
    example:
      "Example: a physically demanding job (construction, moving, etc.) combined with regular training, or twice-daily athletic training.",
  },
};

export const ACTIVITY_LEVEL_ORDER: ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
];
