import Image from "next/image";
import Link from "next/link";

import { Nav } from "@/components/layout/nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[10%] top-[-6rem] h-64 w-64 rounded-full bg-[var(--shell-glow-a)] blur-3xl" />
        <div className="absolute right-[8%] top-8 h-56 w-56 rounded-full bg-[var(--shell-glow-b)] blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[var(--shell-glow-c)] blur-3xl" />
      </div>

      <header className="relative z-40 border-b border-[var(--color-border)]/90 bg-[var(--header-bg)] backdrop-blur-lg">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--header-rule)] to-transparent" />
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <Link href="/weeks" className="group relative flex min-w-0 items-center">
            <span className="pointer-events-none absolute -inset-x-4 -inset-y-2 -z-10 opacity-0 transition duration-300 group-hover:opacity-100">
              <span className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_40%_50%,var(--shell-glow-a),transparent_65%)]" />
            </span>
            <Image
              src="/logo.png"
              alt="PreEBS logo"
              width={676}
              height={369}
              priority
              className="h-16 w-auto object-contain drop-shadow-[0_0_16px_rgba(105,228,138,0.46)] transition duration-300 group-hover:drop-shadow-[0_0_24px_rgba(105,228,138,0.62)] sm:h-20 lg:h-24"
            />
          </Link>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--command-surface)] p-1.5 shadow-[var(--command-shadow)]">
            <Nav />
            <span className="h-7 w-px bg-[var(--color-border-strong)]/70" aria-hidden />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="animate-page-enter mx-auto w-full max-w-7xl px-5 py-8 lg:px-8">{children}</main>
    </div>
  );
}
