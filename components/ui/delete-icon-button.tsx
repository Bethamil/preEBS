"use client";

import { useEffect, useState, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type DeleteIconButtonSize = "sm" | "md";

interface DeleteIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: DeleteIconButtonSize;
  confirm?: boolean;
  confirmLabel?: string;
  confirmTimeoutMs?: number;
}

const sizeStyles: Record<DeleteIconButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

export function DeleteIconButton({
  label,
  size = "md",
  confirm = false,
  confirmLabel,
  confirmTimeoutMs = 4000,
  className,
  type = "button",
  disabled,
  onClick,
  onBlur,
  onKeyDown,
  ...props
}: DeleteIconButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isConfirming) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsConfirming(false);
    }, confirmTimeoutMs);

    return () => window.clearTimeout(timeout);
  }, [confirmTimeoutMs, isConfirming]);

  useEffect(() => {
    if (disabled && isConfirming) {
      setIsConfirming(false);
    }
  }, [disabled, isConfirming]);

  const buttonLabel = isConfirming ? confirmLabel ?? `Confirm ${label.toLowerCase()}` : label;

  return (
    <span className="relative isolate inline-flex items-center">
      <button
        type={type}
        aria-label={buttonLabel}
        title={buttonLabel}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-55",
          isConfirming
            ? "border border-[var(--color-danger)] bg-[var(--color-danger)] text-[var(--color-danger-foreground)] shadow-[0_10px_24px_var(--color-danger-glow)]"
            : "border border-[var(--color-border)] bg-[var(--color-panel-strong)] text-[var(--color-text-soft)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-danger-foreground)] hover:shadow-[0_10px_24px_var(--color-danger-glow)]",
          sizeStyles[size],
          className,
        )}
        onClick={(event) => {
          if (!confirm || disabled) {
            onClick?.(event);
            return;
          }

          if (isConfirming) {
            setIsConfirming(false);
            onClick?.(event);
            return;
          }

          setIsConfirming(true);
        }}
        onBlur={(event) => {
          if (isConfirming) {
            setIsConfirming(false);
          }
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isConfirming) {
            event.preventDefault();
            setIsConfirming(false);
            return;
          }
          onKeyDown?.(event);
        }}
        {...props}
      >
        {isConfirming ? (
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden>
            <path
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
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
        )}
      </button>
      {isConfirming && (
        <span className="pointer-events-none absolute right-full top-1/2 z-20 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--color-danger)] bg-[var(--color-panel)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-danger)] shadow-sm">
          Click again to delete
        </span>
      )}
    </span>
  );
}
