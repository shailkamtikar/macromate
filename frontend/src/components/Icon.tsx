import {
  ArrowRight,
  BarChart3,
  Bell,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Flame,
  GlassWater,
  LayoutDashboard,
  LogOut,
  Menu,
  Minus,
  Palette,
  PartyPopper,
  Pencil,
  Plus,
  Scale,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** One tree-shaken icon set for the whole app (replaces the Material Symbols
 * web font, which was a render-blocking third-party request and showed raw
 * words like "close" until it loaded). Names are the ones the app already
 * uses, so call sites read the same as before. Icons are sized in `em`, so
 * Tailwind text-size classes (text-sm, text-xl...) size them. */
const ICONS = {
  view_agenda: LayoutDashboard,
  auto_awesome: Sparkles,
  neurology: BrainCircuit,
  psychology: BrainCircuit,
  trending_up: TrendingUp,
  trending_down: TrendingDown,
  trending_flat: Minus,
  group: Users,
  person: User,
  monitor_weight: Scale,
  bar_chart: BarChart3,
  local_drink: GlassWater,
  palette: Palette,
  notifications: Bell,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  logout: LogOut,
  menu: Menu,
  close: X,
  check: Check,
  calendar_month: CalendarDays,
  edit: Pencil,
  delete: Trash2,
  add: Plus,
  celebration: PartyPopper,
  local_fire_department: Flame,
  visibility: Eye,
  visibility_off: EyeOff,
  arrow_forward: ArrowRight,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className = "",
  strokeWidth = 2,
}: {
  name: IconName | (string & {});
  className?: string;
  strokeWidth?: number;
}) {
  const Cmp: LucideIcon = (ICONS as Record<string, LucideIcon>)[name] ?? Sparkles;
  return (
    <Cmp
      width="1em"
      height="1em"
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      className={`inline-block flex-shrink-0 ${className}`}
    />
  );
}
