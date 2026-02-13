"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_HOUR_TYPE_ID,
  DEFAULT_HOUR_TYPE_NAME,
  WEEKDAY_COUNT,
  WEEKDAY_LABELS,
} from "@/lib/constants";
import {
  formatDateLabel,
  formatWeekRange,
  getWeekDates,
  nextWeekStart,
  previousWeekStart,
} from "@/lib/date";
import type { RecentCombo, UserConfig, WeekDocument, WeekRowInput } from "@/lib/types";
import { clampHours, cn, formatHours, parseNumberInput } from "@/lib/utils";

interface WeekEditorResponse {
  config: UserConfig;
  week: WeekDocument;
  recentCombos: RecentCombo[];
}

interface LocalRow {
  id: string;
  projectId: string;
  taskId: string;
  hourTypeId: string;
  hours: number[];
  note?: string;
}

interface AddRowOptions {
  combo?: RecentCombo;
  overrideProjectId?: string;
  overrideTaskId?: string;
  overrideHourTypeId?: string;
  presetDayIndex?: number;
  presetHours?: number;
  fillWholeWeek?: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function toLocalRows(week: WeekDocument): LocalRow[] {
  return week.rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    hourTypeId: row.hourTypeId,
    hours: Array.from({ length: WEEKDAY_COUNT }, (_, index) => clampHours(row.hours[index] ?? 0)),
    note: row.note,
  }));
}

function serializeRows(rows: LocalRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      ...row,
      hours: row.hours.map((hours) => clampHours(hours)),
    })),
  );
}

function toPayload(rows: LocalRow[]): WeekRowInput[] {
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    hourTypeId: row.hourTypeId,
    hours: row.hours.map((hours) => clampHours(hours)),
    note: row.note,
  }));
}

export function WeekEntryClient({ weekStartDate }: { weekStartDate: string }) {
  const { pushToast } = useToast();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [recentCombos, setRecentCombos] = useState<RecentCombo[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [focusedDayIndex, setFocusedDayIndex] = useState<number | null>(0);
  const [rowSearch, setRowSearch] = useState("");

  const [quickProjectId, setQuickProjectId] = useState("");
  const [quickTaskId, setQuickTaskId] = useState("");
  const [quickHourTypeId, setQuickHourTypeId] = useState("");
  const [quickDayIndex, setQuickDayIndex] = useState(0);
  const [quickHours, setQuickHours] = useState("8");

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const weekDates = useMemo(
    () => getWeekDates(weekStartDate as WeekDocument["weekStartDate"]),
    [weekStartDate],
  );

  const load = async () => {
    setLoading(true);
    const response = await fetch(`/api/weeks/${weekStartDate}`, { cache: "no-store" });
    const data = (await response.json()) as WeekEditorResponse;

    const localRows = toLocalRows(data.week);
    const snapshot = serializeRows(localRows);

    setConfig(data.config);
    setRows(localRows);
    setRecentCombos(data.recentCombos);
    setLastSavedSnapshot(snapshot);
    setSaveState("idle");
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartDate]);

  const projects = config?.projects ?? [];

  useEffect(() => {
    if (!projects.some((project) => project.id === activeTab) && activeTab !== "all") {
      setActiveTab("all");
    }
  }, [projects, activeTab]);

  const defaultSelection = useMemo(() => {
    const fallbackProject = projects[0];
    const fallbackTask = fallbackProject?.tasks[0];
    const fallbackHourType = fallbackTask?.hourTypes[0];

    return {
      projectId: fallbackProject?.id,
      taskId: fallbackTask?.id,
      hourTypeId: fallbackHourType?.id,
    };
  }, [projects]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    if (!quickProjectId || !projects.some((project) => project.id === quickProjectId)) {
      setQuickProjectId(defaultSelection.projectId ?? projects[0].id);
    }
  }, [projects, quickProjectId, defaultSelection.projectId]);

  const quickProject = useMemo(
    () => projects.find((project) => project.id === quickProjectId),
    [projects, quickProjectId],
  );

  const quickTasks = quickProject?.tasks ?? [];

  useEffect(() => {
    if (quickTasks.length === 0) {
      setQuickTaskId("");
      return;
    }
    if (!quickTaskId || !quickTasks.some((task) => task.id === quickTaskId)) {
      setQuickTaskId(quickTasks[0].id);
    }
  }, [quickTasks, quickTaskId]);

  const quickTask = useMemo(
    () => quickTasks.find((task) => task.id === quickTaskId),
    [quickTasks, quickTaskId],
  );

  const quickHourTypes = quickTask?.hourTypes ?? [];

  useEffect(() => {
    if (quickHourTypes.length === 0) {
      setQuickHourTypeId("");
      return;
    }

    if (!quickHourTypeId || !quickHourTypes.some((type) => type.id === quickHourTypeId)) {
      const defaultHourType =
        quickHourTypes.find((type) => type.name === DEFAULT_HOUR_TYPE_NAME) ?? quickHourTypes[0];
      setQuickHourTypeId(defaultHourType.id);
    }
  }, [quickHourTypes, quickHourTypeId]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        addRow();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, config, activeTab]);

  const snapshot = useMemo(() => serializeRows(rows), [rows]);

  useEffect(() => {
    if (loading || !config || snapshot === lastSavedSnapshot || saveState === "saving") {
      return;
    }

    setSaveState("idle");
    const handle = window.setTimeout(() => {
      void save();
    }, 700);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, lastSavedSnapshot, loading, config]);

  const nameMaps = useMemo(() => {
    const projectMap = new Map<string, string>();
    const taskMap = new Map<string, string>();
    const hourTypeMap = new Map<string, string>();

    for (const project of projects) {
      projectMap.set(project.id, project.name);
      for (const task of project.tasks) {
        taskMap.set(task.id, task.name);
        for (const hourType of task.hourTypes) {
          hourTypeMap.set(hourType.id, hourType.name);
        }
      }
    }

    return { projectMap, taskMap, hourTypeMap };
  }, [projects]);

  const tabRows = useMemo(() => {
    if (activeTab === "all") {
      return rows;
    }
    return rows.filter((row) => row.projectId === activeTab);
  }, [rows, activeTab]);

  const visibleRows = useMemo(() => {
    const query = rowSearch.trim().toLowerCase();
    if (!query) {
      return tabRows;
    }

    return tabRows.filter((row) => {
      const projectName = nameMaps.projectMap.get(row.projectId) ?? "";
      const taskName = nameMaps.taskMap.get(row.taskId) ?? "";
      const hourTypeName = nameMaps.hourTypeMap.get(row.hourTypeId) ?? "";
      const haystack = `${projectName} ${taskName} ${hourTypeName}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [tabRows, rowSearch, nameMaps]);

  const totalsByDay = useMemo(
    () =>
      Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
        rows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
      ),
    [rows],
  );

  const visibleTotalsByDay = useMemo(
    () =>
      Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
        visibleRows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
      ),
    [visibleRows],
  );

  const weekTotal = useMemo(() => totalsByDay.reduce((sum, value) => sum + value, 0), [totalsByDay]);
  const visibleWeekTotal = useMemo(
    () => visibleTotalsByDay.reduce((sum, value) => sum + value, 0),
    [visibleTotalsByDay],
  );
  const groupedVisibleRows = useMemo(() => {
    return projects
      .map((project) => ({
        project,
        rows: visibleRows.filter((row) => row.projectId === project.id),
      }))
      .filter((group) => group.rows.length > 0);
  }, [projects, visibleRows]);
  const projectOverview = useMemo(() => {
    return projects
      .map((project) => {
        const projectRows = rows.filter((row) => row.projectId === project.id);
        if (projectRows.length === 0) {
          return null;
        }

        const total = projectRows.reduce(
          (sum, row) => sum + row.hours.reduce((rowSum, hours) => rowSum + hours, 0),
          0,
        );

        return {
          projectId: project.id,
          projectName: project.name,
          rowCount: projectRows.length,
          total,
        };
      })
      .filter((project): project is NonNullable<typeof project> => Boolean(project));
  }, [projects, rows]);

  const exceedsMax = config ? weekTotal > config.maxHoursPerWeek : false;
  const utilizationPercent = config
    ? Math.min(100, Math.round((weekTotal / Math.max(config.maxHoursPerWeek, 1)) * 100))
    : 0;

  const ensureRowConsistency = (row: LocalRow): LocalRow => {
    const project = projects.find((item) => item.id === row.projectId) ?? projects[0];
    const task = project?.tasks.find((item) => item.id === row.taskId) ?? project?.tasks[0];
    const hourType =
      task?.hourTypes.find((item) => item.id === row.hourTypeId) ??
      task?.hourTypes.find((item) => item.name === DEFAULT_HOUR_TYPE_NAME) ??
      task?.hourTypes[0];

    return {
      ...row,
      projectId: project?.id ?? row.projectId,
      taskId: task?.id ?? row.taskId,
      hourTypeId: hourType?.id ?? row.hourTypeId,
    };
  };

  const addRow = (options?: AddRowOptions) => {
    if (!config || projects.length === 0) {
      pushToast("Add a project in Config first.", "error");
      return;
    }

    const tabProject = activeTab !== "all" ? projects.find((project) => project.id === activeTab) : undefined;

    const baseProjectId =
      options?.overrideProjectId ??
      options?.combo?.projectId ??
      tabProject?.id ??
      defaultSelection.projectId;

    const project = projects.find((item) => item.id === baseProjectId) ?? projects[0];
    const task =
      project.tasks.find((item) => item.id === options?.overrideTaskId) ??
      project.tasks.find((item) => item.id === options?.combo?.taskId) ??
      project.tasks[0];

    const hourType =
      task?.hourTypes.find((item) => item.id === options?.overrideHourTypeId) ??
      task?.hourTypes.find((item) => item.id === options?.combo?.hourTypeId) ??
      task?.hourTypes.find((item) => item.name === DEFAULT_HOUR_TYPE_NAME) ??
      task?.hourTypes[0] ?? { id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME };

    if (!task) {
      pushToast("This project has no task yet. Add one in Config.", "error");
      return;
    }

    const hours = [0, 0, 0, 0, 0];
    const presetHours = clampHours(options?.presetHours ?? 0);
    const presetDayIndex = options?.presetDayIndex ?? 0;

    if (presetHours > 0) {
      if (options?.fillWholeWeek) {
        for (let index = 0; index < WEEKDAY_COUNT; index += 1) {
          hours[index] = presetHours;
        }
      } else {
        hours[presetDayIndex] = presetHours;
      }
    }

    const nextRow: LocalRow = {
      id: crypto.randomUUID(),
      projectId: project.id,
      taskId: task.id,
      hourTypeId: hourType.id,
      hours,
    };

    setRows((current) => [...current, ensureRowConsistency(nextRow)]);

    const focusDay = options?.fillWholeWeek ? 0 : presetDayIndex;
    window.setTimeout(() => {
      const key = `${nextRow.id}:${focusDay}`;
      const input = inputRefs.current.get(key);
      input?.focus();
      input?.select();
    }, 10);
  };

  const updateRow = (rowId: string, updater: (row: LocalRow) => LocalRow) => {
    setRows((current) => current.map((row) => (row.id === rowId ? ensureRowConsistency(updater(row)) : row)));
  };

  const deleteRow = (rowId: string) => {
    const confirmed = window.confirm("Delete this row?");
    if (!confirmed) {
      return;
    }
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const duplicateRow = (rowId: string) => {
    const source = rows.find((row) => row.id === rowId);
    if (!source) {
      return;
    }
    const duplicate = { ...source, id: crypto.randomUUID() };
    const sourceIndex = rows.findIndex((row) => row.id === rowId);
    const next = [...rows];
    next.splice(sourceIndex + 1, 0, duplicate);
    setRows(next);
    pushToast("Row duplicated.", "info");
  };

  const fillWholeRow = (rowId: string) => {
    const row = rows.find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    const sourceDay = focusedDayIndex ?? 0;
    const sourceHours = row.hours[sourceDay] ?? 0;

    if (sourceHours <= 0) {
      pushToast("Set hours in the focused day first, then use Fill Week.", "info");
      return;
    }

    updateRow(rowId, (current) => ({
      ...current,
      hours: Array.from({ length: WEEKDAY_COUNT }, () => sourceHours),
    }));
  };

  const clearDay = (dayIndex: number) => {
    const confirmed = window.confirm(
      activeTab === "all"
        ? `Clear all entries for ${WEEKDAY_LABELS[dayIndex]}?`
        : `Clear ${WEEKDAY_LABELS[dayIndex]} for this project tab?`,
    );
    if (!confirmed) {
      return;
    }

    setRows((current) =>
      current.map((row) => {
        if (activeTab !== "all" && row.projectId !== activeTab) {
          return row;
        }
        const hours = [...row.hours];
        hours[dayIndex] = 0;
        return { ...row, hours };
      }),
    );
    pushToast(`${WEEKDAY_LABELS[dayIndex]} cleared.`, "info");
  };

  const save = async () => {
    if (!config) {
      return;
    }

    setSaveState("saving");
    const response = await fetch(`/api/weeks/${weekStartDate}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows: toPayload(rows) }),
    });

    if (!response.ok) {
      setSaveState("error");
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      pushToast(payload.error ?? "Save failed.", "error");
      return;
    }

    setSaveState("saved");
    setLastSavedSnapshot(serializeRows(rows));
  };

  const copyPrevious = async () => {
    if (rows.length > 0) {
      const confirmed = window.confirm("Replace current week rows with a copy of the previous week?");
      if (!confirmed) {
        return;
      }
    }

    const response = await fetch(`/api/weeks/${weekStartDate}/copy-previous`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      pushToast(payload.error ?? "Could not copy previous week.", "error");
      return;
    }

    const data = (await response.json()) as { week: WeekDocument };
    const localRows = toLocalRows(data.week);
    setRows(localRows);
    setLastSavedSnapshot(serializeRows(localRows));
    setSaveState("saved");
    pushToast("Previous week copied.", "success");
  };

  const exportJson = async () => {
    const response = await fetch(`/api/weeks/${weekStartDate}/export`, { cache: "no-store" });
    if (!response.ok) {
      pushToast("Save this week before exporting.", "error");
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
    pushToast("Export complete.", "success");
  };

  const quickAdd = (fillWholeWeek: boolean) => {
    const parsedHours = clampHours(parseNumberInput(quickHours));

    addRow({
      overrideProjectId: quickProjectId,
      overrideTaskId: quickTaskId,
      overrideHourTypeId: quickHourTypeId,
      presetDayIndex: quickDayIndex,
      presetHours: parsedHours,
      fillWholeWeek,
    });
  };

  const visibleRowIds = visibleRows.map((row) => row.id);

  const focusCell = (rowId: string, dayIndex: number) => {
    const key = `${rowId}:${dayIndex}`;
    const input = inputRefs.current.get(key);
    input?.focus();
    input?.select();
  };

  const handleGridKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    rowId: string,
    dayIndex: number,
  ) => {
    const rowIndex = visibleRowIds.indexOf(rowId);

    if (event.key === "ArrowRight" && dayIndex < WEEKDAY_COUNT - 1) {
      event.preventDefault();
      focusCell(rowId, dayIndex + 1);
      return;
    }

    if (event.key === "ArrowLeft" && dayIndex > 0) {
      event.preventDefault();
      focusCell(rowId, dayIndex - 1);
      return;
    }

    if (event.key === "ArrowDown" && rowIndex < visibleRowIds.length - 1) {
      event.preventDefault();
      focusCell(visibleRowIds[rowIndex + 1], dayIndex);
      return;
    }

    if (event.key === "ArrowUp" && rowIndex > 0) {
      event.preventDefault();
      focusCell(visibleRowIds[rowIndex - 1], dayIndex);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (dayIndex < WEEKDAY_COUNT - 1) {
        focusCell(rowId, dayIndex + 1);
      } else if (rowIndex < visibleRowIds.length - 1) {
        focusCell(visibleRowIds[rowIndex + 1], 0);
      }
    }
  };

  if (loading || !config) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading week editor…</p>;
  }

  if (config.projects.length === 0) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-2xl font-semibold">Week Entry</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--color-text-muted)]">
          Configure at least one project and task first. Then this grid becomes the fastest
          five-day ritual in your calendar.
        </p>
        <Link href="/config" className="mt-6 inline-block">
          <Button>Go To Config</Button>
        </Link>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-[rgba(29,96,112,0.09)] via-[rgba(255,255,255,0.95)] to-[rgba(194,170,122,0.12)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                Week Entry
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{formatHours(weekTotal)}h logged</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {formatWeekRange(
                  weekStartDate as WeekDocument["weekStartDate"],
                  (weekDates[4] ?? weekStartDate) as WeekDocument["weekStartDate"],
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/week/${previousWeekStart(weekStartDate as WeekDocument["weekStartDate"])}`}>
                <Button variant="secondary" size="sm">
                  Previous Week
                </Button>
              </Link>
              <Link href={`/week/${nextWeekStart(weekStartDate as WeekDocument["weekStartDate"])}`}>
                <Button variant="secondary" size="sm">
                  Next Week
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={copyPrevious}>
                Copy Previous
              </Button>
              <Button variant="ghost" size="sm" onClick={exportJson}>
                Export JSON
              </Button>
              <Button onClick={save} size="sm" disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
            <div className="rounded-2xl border border-[var(--color-border)] bg-white/90 px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                <span>Weekly Capacity</span>
                <span>{utilizationPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-panel-strong)]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    exceedsMax ? "bg-[var(--color-warning)]" : "bg-[var(--color-accent)]",
                  )}
                  style={{ width: `${utilizationPercent}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-soft)]">
                {formatHours(weekTotal)}h of {formatHours(config.maxHoursPerWeek)}h
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--color-border)] bg-white/90 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Save Status</p>
              <p className="mt-1 text-xl font-semibold capitalize">{saveState}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Auto-save after edits, or Ctrl/Cmd+S.</p>
            </div>

            <div className="rounded-2xl border border-[var(--color-border)] bg-white/90 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Quick Notes</p>
              <p className="mt-1 text-sm text-[var(--color-text-soft)]">
                Alt+N adds a row. Focus a day, type one cell, then Fill Week for repetitive work.
              </p>
            </div>
          </div>

          {exceedsMax && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Week total exceeds configured max ({formatHours(config.maxHoursPerWeek)}h).{" "}
              {config.blockOnMaxHoursExceed
                ? "Saving is blocked until hours are reduced."
                : "You can still save if this week is exceptional."}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1.2fr_1.2fr_0.8fr_0.6fr_auto_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Project</span>
            <Select value={quickProjectId} onChange={(event) => setQuickProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Task</span>
            <Select value={quickTaskId} onChange={(event) => setQuickTaskId(event.target.value)}>
              {quickTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Hour Type</span>
            <Select value={quickHourTypeId} onChange={(event) => setQuickHourTypeId(event.target.value)}>
              {quickHourTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Day</span>
            <Select
              value={String(quickDayIndex)}
              onChange={(event) => setQuickDayIndex(Number(event.target.value))}
            >
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Hours</span>
            <Input value={quickHours} onChange={(event) => setQuickHours(event.target.value)} inputMode="decimal" />
          </label>

          <div className="self-end">
            <Button className="w-full" onClick={() => quickAdd(false)}>
              Add Row
            </Button>
          </div>

          <div className="self-end">
            <Button variant="secondary" className="w-full" onClick={() => quickAdd(true)}>
              Add + Fill Week
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={activeTab === "all" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("all")}
            >
              All Projects
            </Button>
            {config.projects.map((project) => (
              <Button
                key={project.id}
                variant={activeTab === project.id ? "primary" : "secondary"}
                size="sm"
                onClick={() => setActiveTab(project.id)}
              >
                {project.name}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Input
                placeholder="Filter rows by project/task/hour type"
                value={rowSearch}
                onChange={(event) => setRowSearch(event.target.value)}
              />
            </div>
            <Button size="sm" onClick={() => addRow()}>
              Add Row
            </Button>
          </div>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-5">
          {WEEKDAY_LABELS.map((label, index) => {
            const dayTarget = config.maxHoursPerWeek / 5;
            const total = totalsByDay[index] ?? 0;
            const overTarget = total > dayTarget;
            const selected = focusedDayIndex === index;

            return (
              <div
                key={label}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left transition",
                  selected
                    ? "border-[var(--color-accent)] bg-[rgba(29,96,112,0.08)]"
                    : "border-[var(--color-border)] bg-white hover:bg-[var(--color-panel-strong)]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{label}</p>
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        "text-xs font-semibold",
                        overTarget ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]",
                      )}
                    >
                      {formatHours(total)}h
                    </p>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-strong)]"
                      onClick={() => clearDay(index)}
                      aria-label={`Clear ${label}`}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateLabel(weekDates[index])}</p>
                <button
                  type="button"
                  className="mt-2 inline-flex rounded-md bg-[var(--color-panel-strong)] px-2 py-1 text-xs font-medium text-[var(--color-text-soft)] transition hover:bg-[var(--color-border)]"
                  onClick={() => setFocusedDayIndex(index)}
                >
                  Focus Day
                </button>
              </div>
            );
          })}
        </div>

        {recentCombos.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Recent Combos
            </span>
            {recentCombos.map((combo) => (
              <button
                key={`${combo.projectId}:${combo.taskId}:${combo.hourTypeId}`}
                type="button"
                className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-soft)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                onClick={() => addRow({ combo })}
              >
                {combo.projectName} / {combo.taskName} / {combo.hourTypeName}
              </button>
            ))}
          </div>
        )}

        {projectOverview.length > 0 && (
          <div className="mb-4 grid gap-2 md:grid-cols-3">
            {projectOverview.map((project) => (
              <button
                key={project.projectId}
                type="button"
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition",
                  activeTab === project.projectId
                    ? "border-[var(--color-accent)] bg-[rgba(29,96,112,0.08)]"
                    : "border-[var(--color-border)] bg-white hover:bg-[var(--color-panel-strong)]",
                )}
                onClick={() => setActiveTab(project.projectId)}
              >
                <p className="truncate text-sm font-semibold">{project.projectName}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {project.rowCount} row{project.rowCount === 1 ? "" : "s"} · {formatHours(project.total)}h
                </p>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {groupedVisibleRows.length === 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-10 text-center text-[var(--color-text-muted)]">
              No rows for this filter/tab. Add one from Quick Add above.
            </div>
          )}

          {groupedVisibleRows.map(({ project, rows: projectRows }) => {
            const projectTotalsByDay = Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
              projectRows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
            );
            const projectTotal = projectTotalsByDay.reduce((sum, value) => sum + value, 0);

            return (
              <section key={project.id} className="rounded-2xl border border-[var(--color-border)] bg-white">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3">
                  <div>
                    <h3 className="text-base font-semibold">{project.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {projectRows.length} row{projectRows.length === 1 ? "" : "s"} · {formatHours(projectTotal)}h
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => addRow({ overrideProjectId: project.id })}>
                    Add Row To Project
                  </Button>
                </header>

                <div className="p-2">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      <col className="w-[22%]" />
                      <col className="w-[20%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[8%]" />
                      <col className="w-[6%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                        <th className="px-2 py-2 font-medium">Task</th>
                        <th className="px-2 py-2 font-medium">Hour Type</th>
                        {WEEKDAY_LABELS.map((label, index) => (
                          <th key={`${project.id}-${label}`} className="px-2 py-2 font-medium">
                            <button
                              type="button"
                              className={cn(
                                "w-full rounded-md px-1 py-1 text-left transition",
                                focusedDayIndex === index && "bg-[rgba(29,96,112,0.08)] text-[var(--color-accent)]",
                              )}
                              onClick={() => setFocusedDayIndex(index)}
                            >
                              {label}
                            </button>
                          </th>
                        ))}
                        <th className="px-2 py-2 font-medium">Total</th>
                        <th className="px-2 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectRows.map((row) => {
                        const task = project.tasks.find((item) => item.id === row.taskId) ?? project.tasks[0];
                        const hourTypes = task?.hourTypes ?? [
                          { id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME },
                        ];
                        const selectedHourTypeName =
                          hourTypes.find((item) => item.id === row.hourTypeId)?.name ?? "";
                        const rowTotal = row.hours.reduce((sum, hours) => sum + hours, 0);

                        return (
                          <tr key={row.id} className="border-t border-[var(--color-border)] align-middle">
                            <td className="px-2 py-2">
                              <Select
                                aria-label="Task"
                                title={task?.name ?? ""}
                                value={row.taskId}
                                onChange={(event) => {
                                  const nextTask = project.tasks.find((item) => item.id === event.target.value);
                                  const nextHourType =
                                    nextTask?.hourTypes.find((type) => type.name === DEFAULT_HOUR_TYPE_NAME) ??
                                    nextTask?.hourTypes[0];

                                  updateRow(row.id, (current) => ({
                                    ...current,
                                    taskId: event.target.value,
                                    hourTypeId: nextHourType?.id ?? current.hourTypeId,
                                  }));
                                }}
                              >
                                {project.tasks.map((taskItem) => (
                                  <option key={taskItem.id} value={taskItem.id}>
                                    {taskItem.name}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-2 py-2">
                              <Select
                                aria-label="Hour Type"
                                title={selectedHourTypeName}
                                value={row.hourTypeId}
                                onChange={(event) => {
                                  updateRow(row.id, (current) => ({
                                    ...current,
                                    hourTypeId: event.target.value,
                                  }));
                                }}
                              >
                                {hourTypes.map((hourType) => (
                                  <option key={hourType.id} value={hourType.id}>
                                    {hourType.name}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            {Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) => (
                              <td
                                key={`${row.id}-${dayIndex}`}
                                className={cn(
                                  "px-2 py-2",
                                  focusedDayIndex === dayIndex && "bg-[rgba(29,96,112,0.08)]",
                                )}
                              >
                                <Input
                                  aria-label={`${WEEKDAY_LABELS[dayIndex]} hours`}
                                  ref={(node) => {
                                    const key = `${row.id}:${dayIndex}`;
                                    if (node) {
                                      inputRefs.current.set(key, node);
                                    } else {
                                      inputRefs.current.delete(key);
                                    }
                                  }}
                                  inputMode="decimal"
                                  value={row.hours[dayIndex] === 0 ? "" : row.hours[dayIndex]}
                                  onFocus={() => setFocusedDayIndex(dayIndex)}
                                  onChange={(event) => {
                                    const hours = parseNumberInput(event.target.value);
                                    updateRow(row.id, (current) => {
                                      const nextHours = [...current.hours];
                                      nextHours[dayIndex] = hours;
                                      return {
                                        ...current,
                                        hours: nextHours,
                                      };
                                    });
                                  }}
                                  onKeyDown={(event) => handleGridKeyDown(event, row.id, dayIndex)}
                                  className="h-9 w-full text-right font-mono"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center font-semibold">{formatHours(rowTotal)}h</td>
                            <td className="px-2 py-2">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => fillWholeRow(row.id)}>
                                  Fill
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => duplicateRow(row.id)}>
                                  Dup
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => deleteRow(row.id)}>
                                  Del
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--color-border)] bg-[var(--color-panel-strong)] text-xs font-semibold">
                        <td colSpan={2} className="px-2 py-2">
                          Project Totals
                        </td>
                        {projectTotalsByDay.map((total, index) => (
                          <td key={`${project.id}-total-${index}`} className="px-2 py-2 text-center font-mono">
                            {formatHours(total)}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center font-mono">{formatHours(projectTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            );
          })}

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Visible Totals ({visibleRows.length} row{visibleRows.length === 1 ? "" : "s"})
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">Global week: {formatHours(weekTotal)}h</p>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {visibleTotalsByDay.map((total, index) => (
                <div
                  key={`total-${index}`}
                  className={cn(
                    "rounded-lg bg-white px-2 py-2 text-center",
                    focusedDayIndex === index && "ring-2 ring-[var(--color-ring)]",
                  )}
                >
                  <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    {WEEKDAY_LABELS[index]}
                  </p>
                  <p className="font-mono text-sm font-semibold">{formatHours(total)}h</p>
                </div>
              ))}
              <div className="rounded-lg bg-white px-2 py-2 text-center">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">Visible</p>
                <p className="font-mono text-sm font-semibold">{formatHours(visibleWeekTotal)}h</p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
