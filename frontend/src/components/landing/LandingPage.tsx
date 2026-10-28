"use client";

import Link from "next/link";
import { m, useInView } from "motion/react";
import { useRef, useState } from "react";
import { DaySummary } from "@/lib/api";
import { addDays, startOfWeekIso, localDateIso } from "@/lib/date";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WeekColumns } from "@/components/WeekColumns";
import { EnergyHero, InsightCards } from "@/components/today/DayOverview";
import { Reveal, ease } from "@/components/ui/motion";

// ---------------------------------------------------------------------------
// Sample data for the live preview. Nothing here is a real user's data; it
// exists only so the landing page can show the real dashboard components.
// ---------------------------------------------------------------------------
const TARGETS = { calories: 2200, protein_g: 160, carbs_g: 220, fat_g: 65 };
const SAMPLE_WEEK: { calories: number; protein_g: number; carbs_g: number; fat_g: number; water: number }[] = [
  { calories: 2120, protein_g: 158, carbs_g: 205, fat_g: 66, water: 2800 },
  { calories: 2460, protein_g: 171, carbs_g: 262, fat_g: 78, water: 2400 },
  { calories: 1780, protein_g: 122, carbs_g: 180, fat_g: 60, water: 3100 },
  { calories: 2210, protein_g: 164, carbs_g: 214, fat_g: 63, water: 3000 },
  { calories: 1960, protein_g: 149, carbs_g: 190, fat_g: 59, water: 2600 },
  { calories: 2340, protein_g: 168, carbs_g: 240, fat_g: 70, water: 2200 },
  { calories: 1450, protein_g: 96, carbs_g: 150, fat_g: 48, water: 1500 },
];

function buildSample(weekStart: string): Map<string, DaySummary> {
  const map = new Map<string, DaySummary>();
  SAMPLE_WEEK.forEach((d, i) => {
    const date = addDays(weekStart, i);
    map.set(date, {
      date,
      logged: true,
      calories: d.calories,
      protein_g: d.protein_g,
      carbs_g: d.carbs_g,
      fat_g: d.fat_g,
      water_ml: d.water,
      target_calories: TARGETS.calories,
      target_protein_g: TARGETS.protein_g,
      target_carbs_g: TARGETS.carbs_g,
      target_fat_g: TARGETS.fat_g,
      status: { calories: "ok", protein: "ok", carbs: "ok", fat: "ok" },
    });
  });
  return map;
}

/** The real dashboard components fed with sample numbers: click a day and the
 * hero, rings and insight cards change, exactly like the app. */
function LivePreview() {
  const weekStart = startOfWeekIso(localDateIso());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const sample = buildSample(weekStart);
  const [selected, setSelected] = useState(days[3]);
  const index = days.indexOf(selected);
  const d = SAMPLE_WEEK[index];

  return (
    <div className="card card-glow relative overflow-hidden p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="eyebrow">Sample data · try clicking a day</p>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live preview
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <EnergyHero consumed={d} targets={TARGETS} isToday={false} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="card p-4">
            <p className="eyebrow">Week overview</p>
            <WeekColumns
              days={days}
              byDate={sample}
              selected={selected}
              today={days[6]}
              onSelect={setSelected}
              layoutId="landing-week"
            />
          </div>
          <InsightCards consumed={d} targets={TARGETS} waterMl={d.water} waterGoalMl={3000} />
        </div>
      </div>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section ref={ref} className="border-t border-outline-variant py-16 sm:py-24">
      <m.div
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.6, ease: ease.out }}
        className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[220px_1fr]"
      >
        <div>
          <p className="eyebrow">
            <span className="text-primary">{number}</span> / {title}
          </p>
        </div>
        <div>{children}</div>
      </m.div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Log in two taps",
    body: "Search the food database, repeat a recent meal, or just type what you ate — “2 eggs and toast” — and the AI works out the numbers for you to review.",
  },
  {
    n: "02",
    title: "See where you stand",
    body: "Calories, protein, carbs, fat and water against your targets, for today or any day in your calendar. Green means on target.",
  },
  {
    n: "03",
    title: "Get told what to eat next",
    body: "Suggestions come from your own remaining macros, and your Coach answers questions about your real numbers — never invented ones.",
  },
];

const FEATURES: [string, string][] = [
  ["Calendar & history", "Open any past day and see exactly what you ate, drank and weighed. Add or fix entries after the fact."],
  ["AI Calculator", "Describe a meal in plain words. Database matches are used first; anything else is clearly labelled as an estimate."],
  ["Coach", "Ask “how much protein is left?” or “add 3 eggs to breakfast”. It reads your real data and can log for you."],
  ["Smart suggestions", "Ranked from your remaining calories and protein gap, preferring foods you already eat."],
  ["Friends & streaks", "A weekly leaderboard of discipline, streaks, and a quiet “Aarav added lunch” nudge — no calories shared."],
  ["Hydration", "Tap a glass, set your own bottle sizes, watch the water fill up."],
];

export function LandingPage() {
  return (
    <div className="relative flex-1 overflow-x-clip">
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-30 border-b border-outline-variant/60 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" aria-label="MacroMate home">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            <a href="#how" className="eyebrow transition-colors hover:text-on-surface">How it works</a>
            <a href="#inside" className="eyebrow transition-colors hover:text-on-surface">What&apos;s inside</a>
            <a href="#privacy" className="eyebrow transition-colors hover:text-on-surface">Privacy</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-transform active:scale-95"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="relative">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[640px]" />
        <div
          aria-hidden="true"
          className="drift pointer-events-none absolute left-1/2 top-10 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
          <Reveal>
            <p className="eyebrow">Macro tracking · AI coach · Friends</p>
          </Reveal>
          <Reveal index={1}>
            <h1 className="mt-5 max-w-4xl font-serif text-[2.75rem] leading-[0.98] tracking-tight text-on-surface sm:text-7xl lg:text-[5.5rem]">
              Your nutrition,
              <br />
              finally <em className="text-primary">in focus.</em>
            </h1>
          </Reveal>
          <Reveal index={2}>
            <p className="mt-6 max-w-xl text-base text-on-surface-variant sm:text-lg">
              Log a meal in two taps, see every macro against your target, and get a coach that
              only ever talks about <em className="not-italic text-on-surface">your real numbers</em>.
            </p>
          </Reveal>
          <Reveal index={3} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="group relative inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-on-primary transition-transform active:scale-95"
            >
              Start tracking — it&apos;s free
              <Icon name="arrow_forward" className="text-base transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-outline-variant px-6 py-3.5 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container"
            >
              I already have an account
            </Link>
          </Reveal>

          <m.div
            className="mt-14"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: ease.out, delay: 0.35 }}
          >
            <LivePreview />
            <p className="mt-3 font-mono text-[11px] text-on-surface-variant">
              <span className="text-primary">FIG. 1</span> The Today dashboard, running on sample data.
              Click a day.
            </p>
          </m.div>
        </div>
      </section>

      {/* ---------- 01 how it works ---------- */}
      <div id="how" />
      <Section number="01" title="How it works">
        <ol className="divide-y divide-outline-variant">
          {STEPS.map((step) => (
            <li key={step.n} className="grid gap-3 py-7 first:pt-0 sm:grid-cols-[88px_1fr]">
              <span className="font-mono text-3xl text-primary">{step.n}</span>
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-on-surface">{step.title}</h3>
                <p className="mt-2 max-w-xl text-on-surface-variant">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---------- 02 what's inside ---------- */}
      <div id="inside" />
      <Section number="02" title="What's inside">
        <p className="eyebrow mb-4">
          <span className="text-primary">TABLE 1</span> Everything in the app
        </p>
        <dl className="divide-y divide-outline-variant border-y border-outline-variant">
          {FEATURES.map(([name, text]) => (
            <m.div
              key={name}
              className="grid gap-1 py-5 sm:grid-cols-[220px_1fr] sm:gap-6"
              whileHover={{ x: 4 }}
              transition={{ duration: 0.2 }}
            >
              <dt className="font-display text-base font-bold text-on-surface">{name}</dt>
              <dd className="text-sm text-on-surface-variant">{text}</dd>
            </m.div>
          ))}
        </dl>
      </Section>

      {/* ---------- 03 privacy ---------- */}
      <div id="privacy" />
      <Section number="03" title="Privacy">
        <p className="max-w-2xl font-serif text-3xl leading-tight text-on-surface sm:text-4xl">
          Your food diary is <em className="text-primary">yours.</em> Friends see that you logged a
          meal — never what was in it.
        </p>
        <ul className="mt-8 grid gap-4 text-sm text-on-surface-variant sm:grid-cols-3">
          <li className="card p-4">
            <p className="eyebrow mb-1">Friends</p>
            Only accepted friends can see your streak and weekly score. Opt out any time.
          </li>
          <li className="card p-4">
            <p className="eyebrow mb-1">AI</p>
            Numbers come from a database and deterministic math. The AI only reads and phrases.
          </li>
          <li className="card p-4">
            <p className="eyebrow mb-1">Data</p>
            No ads, no selling data. Row-level security keeps every account&apos;s rows private.
          </li>
        </ul>
      </Section>

      {/* ---------- closing call to action ---------- */}
      <section className="border-t border-outline-variant px-5 py-20 sm:py-28">
        <m.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: ease.out }}
          className="relative mx-auto max-w-3xl"
        >
          <div className="card card-glow relative p-8 sm:p-12">
            {["left-3 top-3 border-l border-t", "right-3 top-3 border-r border-t", "bottom-3 left-3 border-b border-l", "bottom-3 right-3 border-b border-r"].map((c) => (
              <span key={c} aria-hidden="true" className={`absolute h-4 w-4 border-primary ${c}`} />
            ))}
            <p className="eyebrow">Next</p>
            <h2 className="mt-3 font-serif text-4xl leading-tight text-on-surface sm:text-5xl">
              Ready when <em className="text-primary">you are.</em>
            </h2>
            <p className="mt-3 max-w-md text-on-surface-variant">
              Set your targets in a minute, log your first meal in two taps.
            </p>
            <Link
              href="/signup"
              className="group mt-7 inline-flex items-center gap-3 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-on-primary transition-transform active:scale-95"
            >
              Create your account
              <Icon name="arrow_forward" className="text-base transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </m.div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-outline-variant px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Logo />
          <div className="w-60">
            <ThemeToggle />
          </div>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Not medical advice. Talk to a professional about health concerns.
          </p>
        </div>
      </footer>
    </div>
  );
}
