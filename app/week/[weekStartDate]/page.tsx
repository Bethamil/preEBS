import { notFound, redirect } from "next/navigation";

import { WeekEntryClient } from "@/components/week/week-entry-client";
import { normalizeWeekStart } from "@/lib/date";

export default async function WeekPage({
  params,
}: {
  params: Promise<{ weekStartDate: string }>;
}) {
  const { weekStartDate } = await params;
  const normalizedWeekStartDate = normalizeWeekStart(weekStartDate);

  if (!normalizedWeekStartDate) {
    notFound();
  }

  if (normalizedWeekStartDate !== weekStartDate) {
    redirect(`/week/${normalizedWeekStartDate}`);
  }

  return <WeekEntryClient weekStartDate={normalizedWeekStartDate} />;
}
