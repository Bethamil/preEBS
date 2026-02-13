import { NextResponse } from "next/server";

import { normalizeWeekStart, previousWeekStart } from "@/lib/date";
import { copyPreviousWeek } from "@/lib/store";
import type { WeekDocument } from "@/lib/types";

export async function POST(
  _request: Request,
  context: { params: Promise<{ weekStartDate: string }> },
) {
  const params = await context.params;
  const weekStartDate = normalizeWeekStart(params.weekStartDate);
  if (!weekStartDate) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const sourceStart = previousWeekStart(weekStartDate);
  const copied = await copyPreviousWeek(
    weekStartDate as WeekDocument["weekStartDate"],
    sourceStart as WeekDocument["weekStartDate"],
  );

  if (!copied) {
    return NextResponse.json(
      { error: "No previous week found to copy." },
      { status: 404 },
    );
  }

  return NextResponse.json({ week: copied });
}
