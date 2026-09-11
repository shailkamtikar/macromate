"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navItems";
import { useSession } from "@/lib/useSession";
import { useProfile } from "@/lib/useProfile";
import { supabase } from "@/lib/supabaseClient";
import { GlassSizesManager } from "@/components/GlassSizesManager";
import { NotificationsManager } from "@/components/NotificationsManager";
import { ThemeToggle } from "@/components/ThemeToggle";
import ProfilePage from "@/app/profile/page";

type SectionKey =
  | "profile"
  | "weight-goal"
  | "macros"
  | "glasses"
  | "appearance"
  | "notifications";

const SECTIONS: { key: SectionKey; label: string; icon: string; anchor?: string }[] = [
  { key: "profile", label: "Profile", icon: "person", anchor: "profile-basics-section" },
  { key: "weight-goal", label: "Weight goal", icon: "monitor_weight", anchor: "weight-goal-section" },
  { key: "macros", label: "Calories & macros", icon: "bar_chart", anchor: "calorie-macro-section" },
  { key: "glasses", label: "Glass sizes", icon: "local_drink" },
  { key: "appearance", label: "Appearance", icon: "palette" },
  { key: "notifications", label: "Notifications", icon: "notifications" },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * The persistent application shell chrome (PRD-style "central place for
 * profile/settings/preferences"): primary navigation, then the six
 * settings groups, then Account/Logout pinned at the very bottom. One
 * component/data structure powers both the desktop rail (collapsible,
 * always mounted) and the mobile drawer (a temporary overlay opened from a
 * menu button) — see `renderRail` below.
 *
 * Profile / Weight goal / Calories & macros show real live values (from
 * the same `useProfile` hook every other screen uses — no second
 * calculation path) plus an "Edit" action that opens the existing
 * ProfilePage form in an overlay, scrolled to the relevant part of it.
 * That form owns 100% of the actual editing/save/recalculation logic;
 * nothing here duplicates it. Glass sizes / Appearance / Notifications are
 * simple enough to edit inline, so they embed the same manager components
 * ProfilePage itself would otherwise use — one implementation, reused.
 */
export function AppSidebar({ collapsed, onToggleCollapsed }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const profile = useProfile(session?.user.id);

  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fullEditorOpen, setFullEditorOpen] = useState(false);
  const scrollTargetRef = useRef<string | null>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseRef = useRef<HTMLButtonElement | null>(null);

  // Close the mobile drawer on navigation — it's a temporary overlay, not
  // a persistent element, so a route change should never leave it open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset on navigation, not data-fetch sync
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) mobileCloseRef.current?.focus();
    else mobileTriggerRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    if (!fullEditorOpen) return;
    const id = scrollTargetRef.current;
    if (!id) return;
    // The embedded ProfilePage fetches its own data before it can render
    // the target section — wait a tick for it to mount before scrolling.
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(timer);
  }, [fullEditorOpen]);

  useEffect(() => {
    if (!mobileOpen && !fullEditorOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setFullEditorOpen(false);
      setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, fullEditorOpen]);

  function openFullEditor(anchor?: string) {
    scrollTargetRef.current = anchor ?? null;
    setFullEditorOpen(true);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function renderSectionBody(key: SectionKey) {
    if (key === "glasses") return <GlassSizesManager />;
    if (key === "appearance") return <ThemeToggle />;
    if (key === "notifications") return <NotificationsManager />;

    if (!profile) return <p className="text-xs text-on-surface-variant">Loading…</p>;

    if (key === "profile") {
      return (
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-on-surface">{profile.username}</p>
          {session?.user.email && (
            <p className="truncate text-xs text-on-surface-variant">{session.user.email}</p>
          )}
          <button
            type="button"
            onClick={() => openFullEditor("profile-basics-section")}
            className="text-xs font-semibold text-primary"
          >
            Edit profile
          </button>
        </div>
      );
    }
    if (key === "weight-goal") {
      return (
        <div className="space-y-1 text-sm">
          <p className="text-on-surface-variant">
            Goal: <span className="font-semibold capitalize text-on-surface">{profile.goal}</span>
          </p>
          {profile.goal !== "maintain" && profile.rate_kg_per_week != null && (
            <p className="text-on-surface-variant">
              Rate:{" "}
              <span className="font-semibold text-on-surface">
                {profile.rate_kg_per_week} kg/week
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={() => openFullEditor("weight-goal-section")}
            className="text-xs font-semibold text-primary"
          >
            Edit weight &amp; goal
          </button>
        </div>
      );
    }
    // "macros"
    return (
      <div className="space-y-1 text-sm">
        <p className="text-on-surface-variant">
          <span className="font-semibold text-on-surface">{profile.target_calories}</span> kcal ·{" "}
          <span className="capitalize">{profile.macro_mode}</span>
        </p>
        <p className="text-xs text-on-surface-variant">
          P {profile.target_protein_g}g · C {profile.target_carbs_g}g · F {profile.target_fat_g}g
        </p>
        <button
          type="button"
          onClick={() => openFullEditor("calorie-macro-section")}
          className="text-xs font-semibold text-primary"
        >
          Edit calories &amp; macros
        </button>
      </div>
    );
  }

  function renderRail(effectiveCollapsed: boolean, variant: "desktop" | "mobile") {
    function handleSectionToggle(key: SectionKey) {
      if (effectiveCollapsed) onToggleCollapsed();
      setOpenSection((prev) => (prev === key ? null : key));
    }

    return (
      <>
        <nav aria-label="Primary" className="space-y-0.5 px-2 pt-3">
          {NAV_ITEMS.map((item) => {
            const active = !!pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-container/40 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                } ${effectiveCollapsed ? "justify-center" : ""}`}
              >
                <span className="material-symbols-outlined text-xl" aria-hidden>
                  {item.icon}
                </span>
                {!effectiveCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="my-3 border-t border-outline-variant" />

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {!effectiveCollapsed && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Settings
            </p>
          )}
          {SECTIONS.map((section) => {
            const isOpen = !effectiveCollapsed && openSection === section.key;
            const panelId = `sidebar-panel-${variant}-${section.key}`;
            return (
              <div key={section.key}>
                <button
                  type="button"
                  title={section.label}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => handleSectionToggle(section.key)}
                  className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low ${
                    effectiveCollapsed ? "justify-center" : "justify-between"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl" aria-hidden>
                      {section.icon}
                    </span>
                    {!effectiveCollapsed && <span>{section.label}</span>}
                  </span>
                  {!effectiveCollapsed && (
                    <span className="material-symbols-outlined text-base" aria-hidden>
                      {isOpen ? "expand_less" : "expand_more"}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div
                    id={panelId}
                    className="mt-1 rounded-[var(--radius-control)] bg-surface-container-low p-3"
                  >
                    {renderSectionBody(section.key)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-outline-variant p-2">
          <button
            type="button"
            title="Log out"
            onClick={handleLogout}
            className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold text-fat transition-colors hover:bg-fat/10 ${
              effectiveCollapsed ? "justify-center" : ""
            }`}
          >
            <span className="material-symbols-outlined text-xl" aria-hidden>
              logout
            </span>
            {!effectiveCollapsed && <span>Log out</span>}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile menu trigger — the sidebar/drawer's own entry point.
          Primary nav stays reachable via BottomNav on mobile; this opens
          the settings/preferences + account side of the app shell. */}
      <button
        ref={mobileTriggerRef}
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Menu"
        className="fixed left-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface-variant shadow-md lg:hidden"
      >
        <span className="material-symbols-outlined text-xl" aria-hidden="true">menu</span>
      </button>

      {/* Desktop persistent rail */}
      <aside
        data-testid="app-sidebar"
        aria-label="Application"
        className={`fixed left-0 top-0 z-20 hidden h-full flex-col border-r border-outline-variant bg-surface-container-lowest transition-[width] duration-150 lg:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <div
          className={`flex items-center gap-2 px-3 pt-3 ${collapsed ? "justify-center" : "justify-between"}`}
        >
          {!collapsed && (
            <span className="font-display text-sm font-bold text-on-surface">MacroMate</span>
          )}
          <button
            type="button"
            data-testid="app-sidebar-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-lg" aria-hidden>
              {collapsed ? "chevron_right" : "chevron_left"}
            </span>
          </button>
        </div>
        {renderRail(collapsed, "desktop")}
      </aside>

      {/* Mobile drawer. overflow-hidden on this wrapper matters even though
          the panel inside is translated fully off-screen when closed:
          without it, that translated-away panel's own box still counts
          toward document.documentElement.scrollWidth in some browsers,
          producing a few pixels of real (if invisible) horizontal
          scroll on every page underneath, closed drawer or not. */}
      <div
        className={`fixed inset-0 z-40 overflow-hidden lg:hidden ${mobileOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!mobileOpen}
      >
        <div
          onClick={() => setMobileOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-surface-container-lowest shadow-xl transition-transform duration-200 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-3 pt-3">
            <span className="font-display text-sm font-bold text-on-surface">MacroMate</span>
            <button
              ref={mobileCloseRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden="true">close</span>
            </button>
          </div>
          {renderRail(false, "mobile")}
        </div>
      </div>

      {/* Full editor overlay — the existing real Profile & settings form,
          opened by an "Edit" action above and reused as-is. overflow-hidden
          here for the same reason as the mobile drawer above. */}
      <div
        className={`fixed inset-0 z-50 overflow-hidden ${fullEditorOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!fullEditorOpen}
      >
        <div
          onClick={() => setFullEditorOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            fullEditorOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Profile & settings"
          className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col overflow-y-auto bg-surface shadow-xl transition-transform duration-200 sm:max-w-md ${
            fullEditorOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant bg-surface px-4 py-3">
            <span className="text-sm font-semibold text-on-surface">Profile &amp; settings</span>
            <button
              type="button"
              onClick={() => setFullEditorOpen(false)}
              aria-label="Close profile & settings"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden="true">close</span>
            </button>
          </div>
          <div className="flex-1">{fullEditorOpen && <ProfilePage />}</div>
        </div>
      </div>
    </>
  );
}
