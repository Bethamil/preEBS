import { NextResponse } from "next/server";

import { buildConfigExportDocument } from "@/lib/config-transfer";
import { getConfig } from "@/lib/store";

export async function GET() {
  const config = await getConfig();
  const document = buildConfigExportDocument(config);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return NextResponse.json(document, {
    headers: {
      "Content-Disposition": `attachment; filename="preebs-config-${dateStamp}.json"`,
    },
  });
}
