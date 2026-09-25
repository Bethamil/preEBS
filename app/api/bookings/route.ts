import { NextResponse } from "next/server";

import { bookHours, BookingError } from "@/lib/store";
import type { BookingInput } from "@/lib/types";

export async function POST(request: Request) {
  let input: BookingInput;
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    input = body as BookingInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const booking = await bookHours(input);
    return NextResponse.json({ booking });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
