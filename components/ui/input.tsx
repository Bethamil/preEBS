import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-3 text-sm text-[var(--color-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
