import Link from "next/link";

import { currentWeekStart } from "@/lib/date";

import { Nav } from "@/components/layout/nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const weekStart = currentWeekStart();

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[12%] top-[-4rem] h-52 w-52 rounded-full bg-[rgba(21,80,94,0.15)] blur-3xl" />
        <div className="absolute right-[8%] top-12 h-44 w-44 rounded-full bg-[rgba(194,170,122,0.20)] blur-3xl" />
      </div>

      <header className="sticky top-0 z-40 border-b border-[var(--color-border)]/80 bg-[var(--color-bg)]/93 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-5">
            <Link href={`/week/${weekStart}`} className="group flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-accent)] text-sm font-bold text-[var(--color-accent-foreground)]">
                PE
              </span>
              <div>
                <p className="font-semibold tracking-tight">PreEBS</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Timesheets without the suffering.
                </p>
              </div>
            </Link>
            <Nav />
          </div>

          <Link
            href={`/week/${weekStart}`}
            className="rounded-xl bg-[var(--color-panel)] px-3 py-2 text-sm font-medium text-[var(--color-text)] ring-1 ring-[var(--color-border)] transition hover:bg-[var(--color-panel-strong)]"
          >
            This Week
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 py-8 lg:px-8">{children}</main>
    </div>
  );
}
