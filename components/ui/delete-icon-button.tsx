import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type DeleteIconButtonSize = "sm" | "md";

interface DeleteIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: DeleteIconButtonSize;
}

const sizeStyles: Record<DeleteIconButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

export function DeleteIconButton({
  label,
  size = "md",
  className,
  type = "button",
  ...props
}: DeleteIconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-soft)] shadow-[0_1px_2px_rgba(10,20,35,0.05)] transition hover:border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white hover:shadow-[0_4px_12px_rgba(180,83,77,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-55",
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      <svg viewBox="0 0 16 16" className="h-6 w-6" fill="none" aria-hidden>
        <path
          d="M2.5 4h11M6 2.5h4M5 4v8.5c0 .55.45 1 1 1h4c.55 0 1-.45 1-1V4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M7 6.5v4.5M9 6.5v4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  );
}
