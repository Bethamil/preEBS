import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-[var(--color-border)] bg-white px-3 pr-9 text-sm text-[var(--color-text)] shadow-[0_1px_2px_rgba(10,20,35,0.04)] transition overflow-hidden text-ellipsis whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
