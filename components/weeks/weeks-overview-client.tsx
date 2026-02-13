"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { currentWeekStart, formatWeekRange } from "@/lib/date";
import type { WeekSummary } from "@/lib/types";
import { formatHours } from "@/lib/utils";

interface WeeksResponse {
  weeks: WeekSummary[];
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}

export function WeeksOverviewClient() {
  const { pushToast } = useToast();
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const debouncedSearch = useDebounced(search, 250);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const query = new URLSearchParams();
      if (debouncedSearch.trim()) {
        query.set("q", debouncedSearch.trim());
      }

      const response = await fetch(`/api/weeks?${query.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as WeeksResponse;
      setWeeks(data.weeks);
      setLoading(false);
    };

    run();
  }, [debouncedSearch]);

  const totalLogged = useMemo(
    () => weeks.reduce((sum, week) => sum + week.totalHours, 0),
    [weeks],
  );

  const exportWeek = async (weekStartDate: string) => {
    const response = await fetch(`/api/weeks/${weekStartDate}/export`, {
      cache: "no-store",
    });

    if (!response.ok) {
      pushToast("Export failed. The selected week may be empty.", "error");
      return;
    }

    const json = await response.text();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preebs-${weekStartDate}.json`;
    link.click();
    URL.revokeObjectURL(url);

    pushToast("JSON export ready.", "success");
  };

  return (
    <section className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Weeks Overview</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Your saved weeks, totals, and one-click export for EBS handoff.
            </p>
          </div>

          <Link href={`/week/${currentWeekStart()}`}>
            <Button>Open Current Week</Button>
          </Link>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="space-y-1">
            <span className="text-sm font-medium">Search by date, project, task, or hour type</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. 2026-02-09 or Development"
            />
          </label>
          <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-sm">
            <p className="text-[var(--color-text-muted)]">Total logged in list</p>
            <p className="text-xl font-semibold">{formatHours(totalLogged)}h</p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="subtle-scroll overflow-x-auto">
          <table className="table-grid min-w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-soft)]">
                <th className="px-4 py-3">Week</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && weeks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[var(--color-text-muted)]">
                    No saved weeks yet. Open this week and start logging.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[var(--color-text-muted)]">
                    Loading weeks…
                  </td>
                </tr>
              )}

              {!loading &&
                weeks.map((week) => (
                  <tr key={week.weekStartDate} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-4 align-middle">
                      <p className="font-semibold">{week.weekStartDate}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatWeekRange(week.weekStartDate, week.weekEndDate)}
                      </p>
                    </td>
                    <td className="px-4 py-4 align-middle font-semibold">
                      {formatHours(week.totalHours)}h
                    </td>
                    <td className="px-4 py-4 align-middle">
                      {week.exceededMaxHours ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                          Exceeded
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                          Within Limit
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 align-middle text-[var(--color-text-muted)]">
                      {new Intl.DateTimeFormat("en-CA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(week.updatedAt))}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex justify-end gap-2">
                        <Link href={`/week/${week.weekStartDate}`}>
                          <Button variant="secondary" size="sm">
                            Open/Edit
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => exportWeek(week.weekStartDate)}
                        >
                          Export JSON
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
