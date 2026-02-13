export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatHours(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2).replace(/\.00$/, "");
}

export function clampHours(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 24) {
    return 24;
  }
  return Math.round(value * 100) / 100;
}

export function safeTrim(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseNumberInput(value: string): number {
  if (value.trim() === "") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clampHours(parsed);
}
