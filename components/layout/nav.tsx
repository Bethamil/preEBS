"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/weeks", label: "Weeks" },
  { href: "/config", label: "Config" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--nav-surface)] p-1 shadow-[var(--surface-inset-shadow)]">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.06em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              active
                ? "border border-[var(--nav-active-border)] bg-[var(--nav-active-bg)] text-[var(--color-text)] shadow-[var(--nav-active-shadow)]"
                : "border border-transparent text-[var(--color-text-soft)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-strong)] hover:text-[var(--color-text)]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
