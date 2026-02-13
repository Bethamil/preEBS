import type { IsoDateString } from "@/lib/types";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function toIsoDate(date: Date): IsoDateString {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getWeekStartMonday(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const distanceToMonday = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + distanceToMonday);
  return copy;
}

export function normalizeWeekStart(value: string): IsoDateString | null {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return null;
  }
  const monday = getWeekStartMonday(parsed);
  return toIsoDate(monday);
}

export function getWeekDates(weekStartDate: IsoDateString): IsoDateString[] {
  const start = parseIsoDate(weekStartDate);
  if (!start) {
    return [];
  }
  return Array.from({ length: 5 }, (_, index) => toIsoDate(addDays(start, index)));
}

export function getWeekEndDate(weekStartDate: IsoDateString): IsoDateString {
  const start = parseIsoDate(weekStartDate);
  if (!start) {
    return weekStartDate;
  }
  return toIsoDate(addDays(start, 4));
}

export function previousWeekStart(weekStartDate: IsoDateString): IsoDateString {
  const start = parseIsoDate(weekStartDate);
  if (!start) {
    return weekStartDate;
  }
  return toIsoDate(addDays(start, -7));
}

export function nextWeekStart(weekStartDate: IsoDateString): IsoDateString {
  const start = parseIsoDate(weekStartDate);
  if (!start) {
    return weekStartDate;
  }
  return toIsoDate(addDays(start, 7));
}

export function currentWeekStart(): IsoDateString {
  return toIsoDate(getWeekStartMonday(new Date()));
}

export function formatDateLabel(isoDate: IsoDateString): string {
  const date = parseIsoDate(isoDate);
  if (!date) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatWeekRange(startIso: IsoDateString, endIso: IsoDateString): string {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) {
    return `${startIso} -> ${endIso}`;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}
