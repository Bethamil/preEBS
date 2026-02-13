import { NextResponse } from "next/server";

import { getWeekEndDate, normalizeWeekStart } from "@/lib/date";
import { getConfig, getRecentCombos, getWeek, saveWeek } from "@/lib/store";
import type { WeekDocument, WeekRowInput } from "@/lib/types";

async function readWeekStart(
  context: { params: Promise<{ weekStartDate: string }> },
): Promise<string | null> {
  const params = await context.params;
  const normalized = normalizeWeekStart(params.weekStartDate);
  return normalized;
}

function emptyWeek(weekStartDate: string): WeekDocument {
  const now = new Date().toISOString();
  return {
    id: `local-user:${weekStartDate}`,
    userId: "local-user",
    weekStartDate: weekStartDate as WeekDocument["weekStartDate"],
    weekEndDate: getWeekEndDate(weekStartDate as WeekDocument["weekStartDate"]),
    rows: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ weekStartDate: string }> },
) {
  const weekStartDate = await readWeekStart(context);
  if (!weekStartDate) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const [config, week, recentCombos] = await Promise.all([
    getConfig(),
    getWeek(weekStartDate as WeekDocument["weekStartDate"]),
    getRecentCombos(),
  ]);

  return NextResponse.json({
    config,
    week: week ?? emptyWeek(weekStartDate),
    recentCombos,
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ weekStartDate: string }> },
) {
  const weekStartDate = await readWeekStart(context);
  if (!weekStartDate) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const body = (await request.json()) as { rows?: WeekRowInput[] };
  const rows = body.rows ?? [];

  const week = await saveWeek(weekStartDate as WeekDocument["weekStartDate"], rows);
  return NextResponse.json({ week });
}
