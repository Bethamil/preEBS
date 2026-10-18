import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "destructive" | "ghost";

type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "border border-[var(--color-accent-border)] bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-alt))] text-[var(--color-accent-foreground)] shadow-[0_12px_26px_var(--color-accent-glow)] hover:brightness-105 focus-visible:ring-[var(--color-ring)]",
  secondary:
    "border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-strong)] focus-visible:ring-[var(--color-ring)]",
  destructive:
    "border border-[var(--color-danger)] bg-[var(--color-danger)] text-[var(--color-danger-foreground)] shadow-[0_10px_24px_var(--color-danger-glow)] hover:bg-[var(--color-danger-strong)] focus-visible:ring-[var(--color-danger)]",
  ghost:
    "border border-transparent text-[var(--color-text-soft)] hover:border-[var(--color-border)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] focus-visible:ring-[var(--color-ring)]",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-55",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    />
  );
}
