import { NextResponse } from "next/server";

import { getConfig, saveConfig } from "@/lib/store";
import type { UserConfig } from "@/lib/types";

export async function GET() {
  const config = await getConfig();
  return NextResponse.json({ config });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<UserConfig>;
  const current = await getConfig();

  const next: UserConfig = {
    ...current,
    ...body,
    projects: body.projects ?? current.projects,
  };

  const config = await saveConfig(next);
  return NextResponse.json({ config });
}
