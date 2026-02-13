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

      <header className="relative z-40 overflow-visible bg-[var(--header-bg)]/40">
        <div className="mx-auto w-full max-w-7xl px-5 pb-4 pt-3 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
            <Link href="/weeks" className="group relative inline-flex min-w-0 shrink-0 items-end">
              <span className="pointer-events-none absolute -inset-x-4 -inset-y-1 -z-10 opacity-0 transition duration-300 group-hover:opacity-100">
                <span className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_40%_50%,var(--shell-glow-a),transparent_64%)]" />
              </span>
              <span className="pointer-events-none absolute left-0 top-6 h-10 w-[17.2rem] rounded-t-xl border border-b-0 border-[var(--color-border)] bg-[var(--command-surface)] shadow-[var(--command-shadow)] sm:w-[20rem] lg:w-[22rem]" />
              <span className="pointer-events-none absolute left-2 top-[2.05rem] h-[2px] w-[16.2rem] bg-gradient-to-r from-transparent via-[var(--header-rule)] to-transparent opacity-80 sm:w-[18.8rem] lg:w-[20.6rem]" />
              <span className="pointer-events-none absolute left-3 top-8 h-6 w-[16rem] bg-[repeating-linear-gradient(180deg,color-mix(in_srgb,var(--color-border-strong)_24%,transparent),color-mix(in_srgb,var(--color-border-strong)_24%,transparent)_1px,transparent_1px,transparent_3px)] opacity-50 sm:w-[18.4rem] lg:w-[20.2rem]" />
              <Image
                src="/logo.png"
                alt="PreEBS logo"
                width={676}
                height={369}
                priority
                className="relative z-10 h-16 w-auto -translate-y-[2px] object-contain drop-shadow-[0_0_16px_var(--color-accent-glow)] transition duration-300 group-hover:drop-shadow-[0_0_26px_var(--color-accent-glow)] sm:h-20 sm:-translate-y-1 lg:h-24"
              />
            </Link>

            <div className="ml-auto flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--command-surface)] p-1.5 shadow-[var(--command-shadow)]">
              <Nav />
              <span className="h-7 w-px bg-[var(--color-border-strong)]/70" aria-hidden />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="animate-page-enter mx-auto w-full max-w-7xl px-5 pb-8 pt-8 lg:px-8 lg:pb-8 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
