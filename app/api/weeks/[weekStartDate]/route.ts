import { NextResponse } from "next/server";

import { getWeekEndDate, normalizeWeekStart } from "@/lib/date";
import { deleteWeek, getConfig, getRecentCombos, getWeek, saveWeek } from "@/lib/store";
import type { WeekCustomProjectInput, WeekDocument, WeekRowInput } from "@/lib/types";

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
    customProjects: [],
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

  const body = (await request.json()) as { rows?: WeekRowInput[]; customProjects?: WeekCustomProjectInput[] };
  const rows = body.rows ?? [];
  const customProjects = body.customProjects ?? [];

  const week = await saveWeek(weekStartDate as WeekDocument["weekStartDate"], rows, customProjects);
  return NextResponse.json({ week });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ weekStartDate: string }> },
) {
  const weekStartDate = await readWeekStart(context);
  if (!weekStartDate) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const existing = await getWeek(weekStartDate as WeekDocument["weekStartDate"]);
  if (!existing) {
    return NextResponse.json({ error: "Week not found" }, { status: 404 });
  }

  await deleteWeek(weekStartDate as WeekDocument["weekStartDate"]);
  return new NextResponse(null, { status: 204 });
}
