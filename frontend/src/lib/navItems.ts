/** Primary application navigation — the single source of truth shared by
 * the mobile bottom nav and the app sidebar/drawer, so the two chrome
 * elements can never silently drift out of sync with each other. */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", label: "Today", icon: "view_agenda" },
  { href: "/calculate", label: "Calculate", icon: "auto_awesome" },
  { href: "/coach", label: "Coach", icon: "neurology" },
  { href: "/progress", label: "Progress", icon: "trending_up" },
  { href: "/friends", label: "Friends", icon: "group" },
];

/** Routes with no authenticated app shell (no sidebar, no bottom nav) — the
 * pre-auth and onboarding flow. */
export const SHELL_HIDDEN_ROUTES = new Set(["/login", "/signup", "/onboarding", "/"]);
