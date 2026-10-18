import { NextRequest, NextResponse } from "next/server";

import { normalizeWeekStart } from "@/lib/date";
import { getWeek, listWeekSummaries, saveWeek } from "@/lib/store";
import type { WeekDocument } from "@/lib/types";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const weeks = await listWeekSummaries(undefined, query);
  return NextResponse.json({ weeks });
}

export async function POST(request: NextRequest) {
  let body: { weekStartDate?: string };
  try {
    body = (await request.json()) as { weekStartDate?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalized = normalizeWeekStart(body.weekStartDate ?? "");

  if (!normalized) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const existing = await getWeek(normalized as WeekDocument["weekStartDate"]);
  if (existing) {
    return NextResponse.json({ error: "Week already exists" }, { status: 409 });
  }

  const week = await saveWeek(normalized as WeekDocument["weekStartDate"], []);
  return NextResponse.json({ week }, { status: 201 });
}
