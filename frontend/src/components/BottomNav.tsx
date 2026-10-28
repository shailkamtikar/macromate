"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { m } from "motion/react";
import { Icon } from "@/components/Icon";
import { ease } from "@/components/ui/motion";
import { NAV_ITEMS, SHELL_HIDDEN_ROUTES } from "@/lib/navItems";

/** Primary navigation for narrow viewports: a floating pill with a sliding
 * highlight. On desktop/laptop widths the persistent AppSidebar rail already
 * provides this same navigation (see AppShell), so this bar hides at the lg
 * breakpoint rather than duplicating a second row of the same links. */
export function BottomNav() {
  const pathname = usePathname();
  if (!pathname || SHELL_HIDDEN_ROUTES.has(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-3 bottom-3 z-40 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="card mx-auto flex max-w-md items-center gap-1 rounded-full px-2 py-2 backdrop-blur-xl">
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-2 transition-colors ${
                active ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              {active && (
                <m.span
                  layoutId="bottom-nav-pill"
                  className="absolute inset-0 rounded-full bg-primary/12 ring-1 ring-primary/25"
                  transition={{ duration: 0.3, ease: ease.out }}
                />
              )}
              <Icon name={item.icon} className="relative text-xl" />
              <span className="relative w-full truncate text-center text-[10px] font-medium">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
