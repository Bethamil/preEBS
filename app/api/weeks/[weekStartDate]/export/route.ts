import { NextResponse } from "next/server";

import { buildWeekExport } from "@/lib/export";
import { normalizeWeekStart } from "@/lib/date";
import { getConfig, getWeek } from "@/lib/store";
import type { WeekDocument } from "@/lib/types";

export async function GET(
  _request: Request,
  context: { params: Promise<{ weekStartDate: string }> },
) {
  const params = await context.params;
  const weekStartDate = normalizeWeekStart(params.weekStartDate);
  if (!weekStartDate) {
    return NextResponse.json({ error: "Invalid week start date" }, { status: 400 });
  }

  const [config, week] = await Promise.all([
    getConfig(),
    getWeek(weekStartDate as WeekDocument["weekStartDate"]),
  ]);

  if (!week) {
    return NextResponse.json({ error: "Week not found" }, { status: 404 });
  }

  const document = buildWeekExport(config, week);

  return NextResponse.json(document, {
    headers: {
      "Content-Disposition": `attachment; filename="preebs-${weekStartDate}.json"`,
    },
  });
}
