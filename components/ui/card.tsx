import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-[0_10px_30px_rgba(10,20,35,0.07)]",
        className,
      )}
      {...props}
    />
  );
}
