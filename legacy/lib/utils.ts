import { HOUR_INCREMENT, MAX_HOURS_PER_CELL } from "@/lib/constants";

const HOURS_DRAFT_PATTERN = /^\d{0,2}([.,][05]?)?$/;

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatHours(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

export function clampHours(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  const snapped = Math.round(value / HOUR_INCREMENT) * HOUR_INCREMENT;
  if (snapped > MAX_HOURS_PER_CELL) {
    return MAX_HOURS_PER_CELL;
  }
  if (snapped < 0) {
    return 0;
  }
  return snapped;
}

export function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isAllowedHoursDraft(value: string): boolean {
  return HOURS_DRAFT_PATTERN.test(value);
}

export function parseNumberInput(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "." || trimmed === ",") {
    return 0;
  }
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clampHours(parsed);
}
