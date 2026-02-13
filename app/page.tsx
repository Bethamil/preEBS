import { redirect } from "next/navigation";

import { currentWeekStart } from "@/lib/date";

export default function HomePage() {
  redirect(`/week/${currentWeekStart()}`);
}
