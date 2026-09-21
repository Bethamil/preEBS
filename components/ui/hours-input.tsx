"use client";

import { forwardRef, useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { formatHours, isAllowedHoursDraft, parseNumberInput } from "@/lib/utils";

interface HoursInputProps {
  value: number;
  ariaLabel: string;
  className?: string;
  blankWhenZero?: boolean;
  onChangeHours: (hours: number) => void;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function displayHours(value: number, blankWhenZero: boolean): string {
  if (blankWhenZero && value === 0) {
    return "";
  }
  return formatHours(value);
}

export const HoursInput = forwardRef<HTMLInputElement, HoursInputProps>(
  (
    {
      value,
      ariaLabel,
      className,
      blankWhenZero = true,
      onChangeHours,
      onFocus,
      onKeyDown,
    },
    ref,
  ) => {
    const [draft, setDraft] = useState<string | null>(null);
    const displayValue = draft ?? displayHours(value, blankWhenZero);

    return (
      <Input
        ref={ref}
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={displayValue}
        onFocus={() => {
          setDraft(displayHours(value, blankWhenZero));
          onFocus?.();
        }}
        onBlur={() => {
          if (draft !== null) {
            const nextHours = parseNumberInput(draft);
            if (nextHours !== value) {
              onChangeHours(nextHours);
            }
          }
          setDraft(null);
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (!isAllowedHoursDraft(next)) {
            return;
          }
          setDraft(next);
          if (/[.,]$/.test(next)) {
            return;
          }
          const nextHours = parseNumberInput(next);
          if (nextHours !== value) {
            onChangeHours(nextHours);
          }
        }}
        onKeyDown={onKeyDown}
        className={className}
      />
    );
  },
);

HoursInput.displayName = "HoursInput";
