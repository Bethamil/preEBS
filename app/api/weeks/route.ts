import { NextRequest, NextResponse } from "next/server";

import { listWeekSummaries } from "@/lib/store";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const weeks = await listWeekSummaries(undefined, query);
  return NextResponse.json({ weeks });
}
