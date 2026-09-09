"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/today", label: "Today", icon: "view_agenda" },
  { href: "/calculate", label: "Calculate", icon: "auto_awesome" },
  { href: "/coach", label: "Coach", icon: "neurology" },
  { href: "/progress", label: "Progress", icon: "trending_up" },
  { href: "/friends", label: "Friends", icon: "group" },
];

export function BottomNav() {
  const pathname = usePathname();
  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/onboarding" ||
    pathname === "/"
  ) {
    return null;
  }

  return (
    <nav className="sticky bottom-0 z-10 border-t border-outline-variant bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-around py-1.5">
        {ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-[64px] flex-col items-center gap-0.5 rounded-[var(--radius-control)] px-3 py-1.5 ${
                active ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl" aria-hidden>
                {item.icon}
              </span>
              <span className="text-[11px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
