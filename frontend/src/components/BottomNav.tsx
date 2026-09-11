"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, SHELL_HIDDEN_ROUTES } from "@/lib/navItems";

/** Primary navigation for narrow viewports. On desktop/laptop widths the
 * persistent AppSidebar rail already provides this same navigation (see
 * AppShell), so this bar hides at the lg breakpoint rather than
 * duplicating a second, redundant row of the same links. */
export function BottomNav() {
  const pathname = usePathname();
  if (!pathname || SHELL_HIDDEN_ROUTES.has(pathname)) {
    return null;
  }

  return (
    <nav className="sticky bottom-0 z-10 border-t border-outline-variant bg-surface/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-2xl items-center py-1.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 ${
                active ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl" aria-hidden>
                {item.icon}
              </span>
              <span className="w-full truncate text-center text-[11px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
