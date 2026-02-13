"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteIconButton } from "@/components/ui/delete-icon-button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { currentWeekStart, formatWeekRange, getIsoWeekNumber, normalizeWeekStart } from "@/lib/date";
import type { WeekSummary } from "@/lib/types";
import { formatHours } from "@/lib/utils";

interface WeeksResponse {
  weeks: WeekSummary[];
}

interface ApiErrorResponse {
  error?: string;
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
  const [newWeekStartDate, setNewWeekStartDate] = useState(currentWeekStart());
  const [creatingWeek, setCreatingWeek] = useState(false);
  const [deletingWeekStartDate, setDeletingWeekStartDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const debouncedSearch = useDebounced(search, 250);

  const loadWeeks = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (debouncedSearch.trim()) {
        query.set("q", debouncedSearch.trim());
      }

      const response = await fetch(`/api/weeks?${query.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        pushToast("Could not load weeks.", "error");
        return;
      }
      const data = (await response.json()) as WeeksResponse;
      setWeeks(data.weeks);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, pushToast]);

  useEffect(() => {
    void loadWeeks();
  }, [loadWeeks]);

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

  const addWeek = async () => {
    const normalizedWeekStartDate = normalizeWeekStart(newWeekStartDate);
    if (!normalizedWeekStartDate) {
      pushToast("Pick a valid week start date.", "error");
      return;
    }

    setCreatingWeek(true);
    try {
      const response = await fetch("/api/weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStartDate: normalizedWeekStartDate }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        if (response.status === 409) {
          pushToast(payload.error ?? "Week already exists.", "error");
          return;
        }
        pushToast(payload.error ?? "Could not create week.", "error");
        return;
      }

      setNewWeekStartDate(normalizedWeekStartDate);
      await loadWeeks();
      pushToast(`Week ${normalizedWeekStartDate} created.`, "success");
    } finally {
      setCreatingWeek(false);
    }
  };

  const removeWeek = async (weekStartDate: string) => {
    setDeletingWeekStartDate(weekStartDate);
    try {
      const response = await fetch(`/api/weeks/${weekStartDate}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        pushToast(payload.error ?? "Could not delete week.", "error");
        return;
      }

      await loadWeeks();
      pushToast(`Week ${weekStartDate} deleted.`, "success");
    } finally {
      setDeletingWeekStartDate(null);
    }
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

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_auto_auto] xl:items-end">
          <label className="space-y-1">
            <span className="text-sm font-medium">Search by date, project, task, or hour type</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. 2026-02-09 or Development"
            />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-medium">Add week (pick any date in that week)</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="date"
                value={newWeekStartDate}
                onChange={(event) => setNewWeekStartDate(event.target.value)}
                className="sm:w-[11rem]"
              />
              <Button onClick={addWeek} disabled={creatingWeek}>
                {creatingWeek ? "Adding..." : "Add Week"}
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-sm">
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
                weeks.map((week) => {
                  const isoWeek = getIsoWeekNumber(week.weekStartDate);

                  return (
                    <tr key={week.weekStartDate} className="border-t border-[var(--color-border)]">
                      <td className="px-4 py-4 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{week.weekStartDate}</p>
                          {isoWeek && (
                            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-soft)]">
                              Week {isoWeek.weekNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {formatWeekRange(week.weekStartDate, week.weekEndDate)}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-middle font-semibold">
                        {formatHours(week.totalHours)}h
                      </td>
                      <td className="px-4 py-4 align-middle">
                        {week.hoursStatus === "match" && (
                          <span className="status-ok rounded-full border px-2.5 py-1 text-xs font-semibold">
                            Matches Required ({formatHours(week.requiredHours)}h)
                          </span>
                        )}
                        {week.hoursStatus === "under" && (
                          <span className="status-warn rounded-full border px-2.5 py-1 text-xs font-semibold">
                            Missing {formatHours(Math.abs(week.hoursDelta))}h
                          </span>
                        )}
                        {week.hoursStatus === "over" && (
                          <span className="status-danger rounded-full border px-2.5 py-1 text-xs font-semibold">
                            Over by {formatHours(week.hoursDelta)}h
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
                          <DeleteIconButton
                            size="sm"
                            label={`Delete week ${week.weekStartDate}`}
                            confirm
                            confirmLabel={`Confirm delete week ${week.weekStartDate}`}
                            onClick={() => removeWeek(week.weekStartDate)}
                            disabled={deletingWeekStartDate === week.weekStartDate}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
