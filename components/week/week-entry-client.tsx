"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteIconButton } from "@/components/ui/delete-icon-button";
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
  getIsoWeekNumber,
  formatWeekRange,
  getWeekDates,
} from "@/lib/date";
import type { RecentCombo, UserConfig, WeekDocument, WeekRowInput } from "@/lib/types";
import { clampHours, cn, formatHours, parseNumberInput } from "@/lib/utils";

const PROJECT_ACCENT_COLORS = [
  "#1D6070",
  "#B8862B",
  "#4B7A4F",
  "#7D5678",
  "#2D6A8A",
  "#8C5A2E",
  "#6A7C2C",
] as const;

const LAST_EDITED_PROJECT_STORAGE_KEY = "preebs:last-edited-project";

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
}

interface ComboOption extends RecentCombo {
  label: string;
  searchText: string;
  isRecent: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";
const HOUR_COMPARE_EPSILON = 0.001;

function comboKey(projectId: string, taskId: string, hourTypeId: string): string {
  return `${projectId}:${taskId}:${hourTypeId}`;
}

function comboLabel(
  combo: { projectName: string; taskName: string; hourTypeName: string },
  includeHourType: boolean,
): string {
  if (!includeHourType) {
    return `${combo.projectName} / ${combo.taskName}`;
  }
  return `${combo.projectName} / ${combo.taskName} / ${combo.hourTypeName}`;
}

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
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [focusedDayIndex, setFocusedDayIndex] = useState<number | null>(0);
  const [rowSearch, setRowSearch] = useState("");
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);

  const [quickComboSearch, setQuickComboSearch] = useState("");

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const quickComboSearchInputRef = useRef<HTMLInputElement | null>(null);

  const weekDates = useMemo(
    () => getWeekDates(weekStartDate as WeekDocument["weekStartDate"]),
    [weekStartDate],
  );
  const isoWeek = useMemo(
    () => getIsoWeekNumber(weekStartDate as WeekDocument["weekStartDate"]),
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

  const rememberEditedProject = (projectId: string) => {
    setOpenProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_EDITED_PROJECT_STORAGE_KEY, projectId);
    }
  };

  const toggleProjectOpen = (projectId: string) => {
    setOpenProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  };

  useEffect(() => {
    if (projects.length === 0) {
      setOpenProjectIds((current) => (current.length === 0 ? current : []));
      return;
    }

    setOpenProjectIds((current) => {
      const validCurrent = current.filter((projectId) =>
        projects.some((project) => project.id === projectId),
      );
      if (validCurrent.length > 0) {
        const unchanged =
          validCurrent.length === current.length &&
          validCurrent.every((projectId, index) => projectId === current[index]);
        if (unchanged) {
          return current;
        }
        return validCurrent;
      }

      const fromStorage =
        typeof window !== "undefined"
          ? window.localStorage.getItem(LAST_EDITED_PROJECT_STORAGE_KEY) ?? ""
          : "";

      if (fromStorage && projects.some((project) => project.id === fromStorage)) {
        return current.length === 1 && current[0] === fromStorage ? current : [fromStorage];
      }

      const fallbackFromRows = rows[rows.length - 1]?.projectId;
      if (fallbackFromRows && projects.some((project) => project.id === fallbackFromRows)) {
        return current.length === 1 && current[0] === fallbackFromRows ? current : [fallbackFromRows];
      }

      return current.length === 1 && current[0] === projects[0].id ? current : [projects[0].id];
    });
  }, [projects, rows]);

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

  const shouldShowHourType = useMemo(() => {
    const normalizedHourTypeNames = new Set<string>();

    for (const project of projects) {
      for (const task of project.tasks) {
        if (task.hourTypes.length !== 1) {
          return true;
        }
        for (const hourType of task.hourTypes) {
          normalizedHourTypeNames.add(hourType.name.trim().toLowerCase());
        }
      }
    }

    return normalizedHourTypeNames.size > 1;
  }, [projects]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.altKey || event.shiftKey) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      quickComboSearchInputRef.current?.focus();
      quickComboSearchInputRef.current?.select();
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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

  const visibleRows = useMemo(() => {
    const query = rowSearch.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    const tokens = query.split(/\s+/).filter(Boolean);

    return rows.filter((row) => {
      const projectName = nameMaps.projectMap.get(row.projectId) ?? "";
      const taskName = nameMaps.taskMap.get(row.taskId) ?? "";
      const hourTypeName = nameMaps.hourTypeMap.get(row.hourTypeId) ?? "";
      const haystack = `${projectName} ${taskName} ${hourTypeName}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [rows, rowSearch, nameMaps]);

  const openVisibleRows = useMemo(() => {
    if (openProjectIds.length === 0) {
      return [];
    }

    const openProjects = new Set(openProjectIds);
    return visibleRows.filter((row) => openProjects.has(row.projectId));
  }, [visibleRows, openProjectIds]);

  const totalsByDay = useMemo(
    () =>
      Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
        rows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
      ),
    [rows],
  );

  const maxHoursPerDay = config?.maxHoursPerDay ?? Array.from({ length: WEEKDAY_COUNT }, () => 0);
  const exceededDayIndexes = useMemo(
    () =>
      totalsByDay.reduce<number[]>((indices, total, dayIndex) => {
        const dayMax = maxHoursPerDay[dayIndex] ?? 0;
        if (total > dayMax + HOUR_COMPARE_EPSILON) {
          indices.push(dayIndex);
        }
        return indices;
      }, []),
    [totalsByDay, maxHoursPerDay],
  );
  const exceededDayIndexSet = useMemo(
    () => new Set<number>(exceededDayIndexes),
    [exceededDayIndexes],
  );
  const exactDayIndexSet = useMemo(
    () =>
      new Set<number>(
        totalsByDay.reduce<number[]>((indices, total, dayIndex) => {
          const dayMax = maxHoursPerDay[dayIndex] ?? 0;
          if (dayMax > 0 && Math.abs(total - dayMax) <= HOUR_COMPARE_EPSILON) {
            indices.push(dayIndex);
          }
          return indices;
        }, []),
      ),
    [totalsByDay, maxHoursPerDay],
  );
  const requiredWeekHours = useMemo(
    () => maxHoursPerDay.reduce((sum, hours) => sum + hours, 0),
    [maxHoursPerDay],
  );
  const weekTotalHours = useMemo(
    () => totalsByDay.reduce((sum, hours) => sum + hours, 0),
    [totalsByDay],
  );
  const weekHoursDelta = weekTotalHours - requiredWeekHours;
  const weekHoursStatus = Math.abs(weekHoursDelta) <= HOUR_COMPARE_EPSILON
    ? "match"
    : weekHoursDelta < 0
      ? "under"
      : "over";

  const projectSummaries = useMemo(() => {
    const summaries = [] as Array<{
      project: UserConfig["projects"][number];
      accentColor: string;
      projectRows: LocalRow[];
      visibleProjectRows: LocalRow[];
      totalsByDay: number[];
      total: number;
      taskCount: number;
      status: "ok" | "warning";
    }>;

    for (let index = 0; index < projects.length; index += 1) {
      const project = projects[index];
      const projectRows = rows.filter((row) => row.projectId === project.id);
      const visibleProjectRows = visibleRows.filter((row) => row.projectId === project.id);
      const totals = Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
        projectRows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
      );
      const total = totals.reduce((sum, value) => sum + value, 0);
      const taskCount = new Set(projectRows.map((row) => row.taskId)).size;

      summaries.push({
        project,
        accentColor: PROJECT_ACCENT_COLORS[index % PROJECT_ACCENT_COLORS.length],
        projectRows,
        visibleProjectRows,
        totalsByDay: totals,
        total,
        taskCount,
        status: totals.some((hours, dayIndex) => hours > (maxHoursPerDay[dayIndex] ?? 0) + HOUR_COMPARE_EPSILON)
          ? "warning"
          : "ok",
      });
    }

    return summaries;
  }, [projects, rows, visibleRows, maxHoursPerDay]);

  const comboOptions = useMemo(() => {
    const recentKeys = new Set(
      recentCombos.map((combo) => comboKey(combo.projectId, combo.taskId, combo.hourTypeId)),
    );

    const options: ComboOption[] = [];

    for (const project of projects) {
      for (const task of project.tasks) {
        for (const hourType of task.hourTypes) {
          const isRecent = recentKeys.has(comboKey(project.id, task.id, hourType.id));
          const option: ComboOption = {
            projectId: project.id,
            projectName: project.name,
            taskId: task.id,
            taskName: task.name,
            hourTypeId: hourType.id,
            hourTypeName: hourType.name,
            label: comboLabel({
              projectName: project.name,
              taskName: task.name,
              hourTypeName: hourType.name,
            }, shouldShowHourType),
            searchText: shouldShowHourType
              ? `${project.name} ${task.name} ${hourType.name}`.toLowerCase()
              : `${project.name} ${task.name}`.toLowerCase(),
            isRecent,
          };
          options.push(option);
        }
      }
    }

    return options.sort((left, right) => {
      if (left.isRecent !== right.isRecent) {
        return left.isRecent ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
  }, [projects, recentCombos, shouldShowHourType]);

  const quickComboMatches = useMemo(() => {
    const query = quickComboSearch.trim().toLowerCase();
    if (!query) {
      return comboOptions.slice(0, 8);
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    return comboOptions
      .filter((option) => tokens.every((token) => option.searchText.includes(token)))
      .slice(0, 8);
  }, [comboOptions, quickComboSearch]);

  const exceedsMax = exceededDayIndexes.length > 0;

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

    const baseProjectId = options?.overrideProjectId ?? options?.combo?.projectId ?? defaultSelection.projectId;
    const project = projects.find((item) => item.id === baseProjectId) ?? projects[0];
    if (project.tasks.length === 0) {
      pushToast("This project has no task yet. Add one in Config.", "error");
      return;
    }

    const explicitTaskId = options?.overrideTaskId ?? options?.combo?.taskId;
    const explicitHourTypeId = options?.overrideHourTypeId ?? options?.combo?.hourTypeId;
    const hasExplicitCombo = Boolean(options?.combo || explicitTaskId || explicitHourTypeId);

    const existingKeys = new Set(
      rows.map((row) => comboKey(row.projectId, row.taskId, row.hourTypeId)),
    );

    const taskCandidates = explicitTaskId
      ? project.tasks.filter((task) => task.id === explicitTaskId)
      : project.tasks;

    let selectedTask: UserConfig["projects"][number]["tasks"][number] | undefined;
    let selectedHourType: { id: string; name: string } | undefined;

    for (const taskCandidate of taskCandidates) {
      const fallbackHourType = { id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME };
      const availableHourTypes = taskCandidate.hourTypes.length > 0 ? taskCandidate.hourTypes : [fallbackHourType];
      const orderedHourTypes = explicitHourTypeId
        ? availableHourTypes.filter((hourType) => hourType.id === explicitHourTypeId)
        : [
            ...(availableHourTypes.find((hourType) => hourType.name === DEFAULT_HOUR_TYPE_NAME)
              ? availableHourTypes.filter((hourType) => hourType.name === DEFAULT_HOUR_TYPE_NAME)
              : []),
            ...availableHourTypes.filter((hourType) => hourType.name !== DEFAULT_HOUR_TYPE_NAME),
          ];

      for (const hourTypeCandidate of orderedHourTypes) {
        const key = comboKey(project.id, taskCandidate.id, hourTypeCandidate.id);
        if (!existingKeys.has(key)) {
          selectedTask = taskCandidate;
          selectedHourType = hourTypeCandidate;
          break;
        }
      }

      if (selectedTask && selectedHourType) {
        break;
      }
    }

    if (!selectedTask || !selectedHourType) {
      const existingRow =
        explicitTaskId || explicitHourTypeId
          ? rows.find(
              (row) =>
                row.projectId === project.id &&
                row.taskId === explicitTaskId &&
                (!explicitHourTypeId || row.hourTypeId === explicitHourTypeId),
            )
          : rows.find((row) => row.projectId === project.id);

      if (existingRow) {
        window.setTimeout(() => {
          const key = `${existingRow.id}:${focusedDayIndex ?? 0}`;
          const input = inputRefs.current.get(key);
          input?.focus();
          input?.select();
        }, 10);
      }

      pushToast(
        hasExplicitCombo
          ? "Task already exists in this project."
          : "All task rows already exist in this project.",
        "info",
      );
      return;
    }

    const hours = [0, 0, 0, 0, 0];
    const presetHours = clampHours(options?.presetHours ?? 0);
    const presetDayIndex = options?.presetDayIndex ?? 0;

    if (presetHours > 0) {
      hours[presetDayIndex] = presetHours;
    }

    const nextRow: LocalRow = {
      id: crypto.randomUUID(),
      projectId: project.id,
      taskId: selectedTask.id,
      hourTypeId: selectedHourType.id,
      hours,
    };

    rememberEditedProject(project.id);
    const normalizedNextRow = ensureRowConsistency(nextRow);
    setRows((current) => [...current, normalizedNextRow]);

    window.setTimeout(() => {
      const key = `${normalizedNextRow.id}:${presetDayIndex}`;
      const input = inputRefs.current.get(key);
      input?.focus();
      input?.select();
    }, 10);
  };

  const updateRow = (rowId: string, updater: (row: LocalRow) => LocalRow, projectHint?: string) => {
    if (projectHint) {
      rememberEditedProject(projectHint);
    }
    let duplicateRowId: string | null = null;
    setRows((current) => {
      const currentRow = current.find((row) => row.id === rowId);
      if (!currentRow) {
        return current;
      }
      const updatedRow = ensureRowConsistency(updater(currentRow));
      const duplicate = current.find(
        (row) =>
          row.id !== rowId &&
          row.projectId === updatedRow.projectId &&
          row.taskId === updatedRow.taskId &&
          row.hourTypeId === updatedRow.hourTypeId,
      );
      if (duplicate) {
        duplicateRowId = duplicate.id;
        return current;
      }

      return current.map((row) => (row.id === rowId ? updatedRow : row));
    });
    if (duplicateRowId) {
      pushToast("Task already exists in this project.", "info");
      window.setTimeout(() => {
        const key = `${duplicateRowId}:${focusedDayIndex ?? 0}`;
        const input = inputRefs.current.get(key);
        input?.focus();
        input?.select();
      }, 10);
    }
  };

  const deleteRow = (rowId: string) => {
    const confirmed = window.confirm("Delete this row?");
    if (!confirmed) {
      return;
    }

    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const clearDay = (dayIndex: number) => {
    const confirmed = window.confirm(`Clear all entries for ${WEEKDAY_LABELS[dayIndex]}?`);
    if (!confirmed) {
      return;
    }

    setRows((current) =>
      current.map((row) => {
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

  const quickAddFromCombo = (combo: ComboOption) => {
    setQuickComboSearch(combo.label);

    addRow({
      overrideProjectId: combo.projectId,
      overrideTaskId: combo.taskId,
      overrideHourTypeId: combo.hourTypeId,
      presetHours: 0,
    });
  };

  const visibleRowIds = openVisibleRows.map((row) => row.id);

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
    return <p className="text-sm text-[var(--color-text-muted)]">Loading week editor...</p>;
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
    <section className="space-y-4 pb-28">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
              Week Entry
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {formatWeekRange(
                weekStartDate as WeekDocument["weekStartDate"],
                (weekDates[4] ?? weekStartDate) as WeekDocument["weekStartDate"],
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
              {isoWeek && (
                <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-soft)]">
                  Week {isoWeek.weekNumber}
                </span>
              )}
              <span>
                {rows.length} row{rows.length === 1 ? "" : "s"} total
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  weekHoursStatus === "match" && "bg-emerald-100 text-emerald-900",
                  weekHoursStatus === "under" && "bg-amber-100 text-amber-900",
                  weekHoursStatus === "over" && "bg-rose-100 text-rose-900",
                )}
              >
                {weekHoursStatus === "match" &&
                  `Matches required (${formatHours(weekTotalHours)}/${formatHours(requiredWeekHours)}h)`}
                {weekHoursStatus === "under" &&
                  `Missing ${formatHours(Math.abs(weekHoursDelta))}h (${formatHours(weekTotalHours)}/${formatHours(requiredWeekHours)}h)`}
                {weekHoursStatus === "over" &&
                  `Over by ${formatHours(weekHoursDelta)}h (${formatHours(weekTotalHours)}/${formatHours(requiredWeekHours)}h)`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copyPrevious}>
              Copy Previous
            </Button>
            <Button variant="ghost" size="sm" onClick={exportJson}>
              Export JSON
            </Button>
          </div>
        </div>

        {exceedsMax && (
          <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            Daily max exceeded for{" "}
            {exceededDayIndexes
              .map(
                (dayIndex) =>
                  `${WEEKDAY_LABELS[dayIndex]} (${formatHours(totalsByDay[dayIndex])}h > ${formatHours(maxHoursPerDay[dayIndex])}h)`,
              )
              .join(", ")}
            .
          </div>
        )}

      </Card>

      <Card className="p-4 sm:p-5">
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Quick Add Search
            </span>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--color-text-muted)]">
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <Input
                ref={quickComboSearchInputRef}
                value={quickComboSearch}
                className="h-11 rounded-xl border-[var(--color-border)] bg-[var(--color-panel-strong)] pl-9 pr-16 text-sm shadow-none"
                onChange={(event) => setQuickComboSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    return;
                  }
                  event.preventDefault();
                  const firstMatch = quickComboMatches[0];
                  if (!firstMatch) {
                    pushToast("No matching combo found.", "info");
                    return;
                  }
                  quickAddFromCombo(firstMatch);
                }}
                placeholder={
                  shouldShowHourType
                    ? "Search project, task, or hour type..."
                    : "Search project or task..."
                }
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <kbd className="inline-flex h-6 items-center rounded-md border border-[var(--color-border)] bg-white px-2 text-[11px] font-medium text-[var(--color-text-muted)]">
                  ⌘K
                </kbd>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quickComboMatches.slice(0, 6).map((combo) => (
              <button
                key={comboKey(combo.projectId, combo.taskId, combo.hourTypeId)}
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text-soft)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                onClick={() => quickAddFromCombo(combo)}
                title={combo.label}
              >
                {combo.isRecent && (
                  <span className="rounded-full bg-[var(--color-panel-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    Recent
                  </span>
                )}
                <span className="truncate">{combo.label}</span>
              </button>
            ))}
            {quickComboMatches.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">No combo matches this search.</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full max-w-md">
            <Input
              placeholder={
                shouldShowHourType
                  ? "Filter rows by project/task/hour type"
                  : "Filter rows by project/task"
              }
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {WEEKDAY_LABELS.map((label, index) => (
            <div
              key={label}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-xl border px-2.5 py-2 transition hover:border-[var(--color-ring)]",
                exceededDayIndexSet.has(index)
                  ? "border-red-300 bg-red-50"
                  : exactDayIndexSet.has(index)
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-[var(--color-border)] bg-white",
                focusedDayIndex === index && "ring-2 ring-[var(--color-ring)]",
              )}
              role="button"
              tabIndex={0}
              onClick={() => setFocusedDayIndex(index)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                setFocusedDayIndex(index);
              }}
              aria-label={`Focus ${label}`}
            >
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">{label}</p>
                <p className="text-xs font-semibold">{formatHours(totalsByDay[index])}h</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">Max {formatHours(maxHoursPerDay[index])}h</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">{formatDateLabel(weekDates[index])}</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel-strong)]"
                onClick={(event) => {
                  event.stopPropagation();
                  clearDay(index);
                }}
                aria-label={`Clear ${label}`}
                title={`Clear ${label}`}
              >
                Clear
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-3">
        {projectSummaries.map((summary) => {
          const { project, accentColor, projectRows, visibleProjectRows, totalsByDay: projectTotalsByDay, total, taskCount, status } = summary;
          const isExpanded = openProjectIds.includes(project.id);
          const rowCount = projectRows.length;
          const visibleRowCount = visibleProjectRows.length;

          return (
            <section
              key={project.id}
              className="rounded-2xl border border-[var(--color-border)] bg-white"
              style={{ borderLeftColor: accentColor, borderLeftWidth: "4px" }}
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => toggleProjectOpen(project.id)}
                  aria-expanded={isExpanded}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: accentColor }}
                      aria-hidden
                    />
                    <h3 className="truncate text-base font-semibold">{project.name}</h3>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                        status === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800",
                      )}
                    >
                      {status === "warning" ? "Warning" : "OK"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {formatHours(total)}h total · {rowCount} row{rowCount === 1 ? "" : "s"} · {taskCount} task
                    {taskCount === 1 ? "" : "s"}
                    {rowSearch.trim().length > 0 && ` · Showing ${visibleRowCount}`}
                  </p>
                </button>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => addRow({ overrideProjectId: project.id })}>
                    Add Row
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleProjectOpen(project.id)}
                  >
                    {isExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
              </header>

              {isExpanded && (
                <div className="p-2 sm:p-3">
                  {visibleRowCount === 0 ? (
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
                      No rows match this filter for this project.
                    </div>
                  ) : (
                    <div className="max-h-[28rem] overflow-y-auto subtle-scroll rounded-xl border border-[var(--color-border)]">
                      <table className="table-grid w-full table-fixed text-sm">
                        <colgroup>
                          <col className={shouldShowHourType ? "w-[24%]" : "w-[32%]"} />
                          {shouldShowHourType && <col className="w-[17%]" />}
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[8%]" : "w-[8.5%]"} />
                          <col className={shouldShowHourType ? "w-[11%]" : "w-[16%]"} />
                        </colgroup>
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                            <th className="px-2 py-2 font-medium">Task</th>
                            {shouldShowHourType && <th className="px-2 py-2 font-medium">Type</th>}
                            {WEEKDAY_LABELS.map((label, index) => (
                              <th key={`${project.id}-${label}`} className="px-1 py-2 font-medium">
                                <button
                                  type="button"
                                  className={cn(
                                    "w-full rounded-md px-1 py-1 text-left text-[10px] transition",
                                    focusedDayIndex === index &&
                                      "bg-[rgba(29,96,112,0.08)] text-[var(--color-accent)]",
                                  )}
                                  onClick={() => setFocusedDayIndex(index)}
                                >
                                  {label}
                                </button>
                              </th>
                            ))}
                            <th className="px-2 py-2 text-center font-medium">Week</th>
                            <th className="px-2 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleProjectRows.map((row) => {
                            const task = project.tasks.find((item) => item.id === row.taskId) ?? project.tasks[0];
                            const hourTypes = task?.hourTypes ?? [
                              { id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME },
                            ];
                            const selectedHourTypeName =
                              hourTypes.find((item) => item.id === row.hourTypeId)?.name ?? "";
                            const rowTotal = row.hours.reduce((sum, hours) => sum + hours, 0);

                            return (
                              <tr
                                key={row.id}
                                className="border-t border-[var(--color-border)] align-middle"
                              >
                                <td className="px-2 py-1.5">
                                  <Select
                                    aria-label="Task"
                                    title={task?.name ?? ""}
                                    value={row.taskId}
                                    className="h-9 rounded-lg px-2 text-sm"
                                    onChange={(event) => {
                                      const nextTask = project.tasks.find((item) => item.id === event.target.value);
                                      const nextHourType =
                                        nextTask?.hourTypes.find((type) => type.name === DEFAULT_HOUR_TYPE_NAME) ??
                                        nextTask?.hourTypes[0];

                                      updateRow(
                                        row.id,
                                        (current) => ({
                                          ...current,
                                          taskId: event.target.value,
                                          hourTypeId: nextHourType?.id ?? current.hourTypeId,
                                        }),
                                        row.projectId,
                                      );
                                    }}
                                  >
                                    {project.tasks.map((taskItem) => (
                                      <option key={taskItem.id} value={taskItem.id}>
                                        {taskItem.name}
                                      </option>
                                    ))}
                                  </Select>
                                </td>
                                {shouldShowHourType && (
                                  <td className="px-2 py-1.5">
                                    <Select
                                      aria-label="Hour Type"
                                      title={selectedHourTypeName}
                                      value={row.hourTypeId}
                                      className="h-9 rounded-lg px-2 text-sm"
                                      onChange={(event) => {
                                        updateRow(
                                          row.id,
                                          (current) => ({
                                            ...current,
                                            hourTypeId: event.target.value,
                                          }),
                                          row.projectId,
                                        );
                                      }}
                                    >
                                      {hourTypes.map((hourType) => (
                                        <option key={hourType.id} value={hourType.id}>
                                          {hourType.name}
                                        </option>
                                      ))}
                                    </Select>
                                  </td>
                                )}
                                {Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) => (
                                  <td
                                    key={`${row.id}-${dayIndex}`}
                                    className={cn(
                                      "px-1 py-1.5",
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
                                      onFocus={() => {
                                        setFocusedDayIndex(dayIndex);
                                      }}
                                      onChange={(event) => {
                                        const hours = parseNumberInput(event.target.value);
                                        updateRow(
                                          row.id,
                                          (current) => {
                                            const nextHours = [...current.hours];
                                            nextHours[dayIndex] = hours;
                                            return {
                                              ...current,
                                              hours: nextHours,
                                            };
                                          },
                                          row.projectId,
                                        );
                                      }}
                                      onKeyDown={(event) => handleGridKeyDown(event, row.id, dayIndex)}
                                      className="h-9 w-full rounded-lg px-2 text-right font-mono text-sm"
                                    />
                                  </td>
                                ))}
                                <td className="px-2 py-1 text-center font-mono text-xs font-semibold sm:text-sm">
                                  {formatHours(rowTotal)}h
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <DeleteIconButton label="Delete row" onClick={() => deleteRow(row.id)} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--color-border)] bg-[var(--color-panel-strong)] text-xs font-semibold">
                            <td colSpan={shouldShowHourType ? 2 : 1} className="px-2 py-2">
                              Project Totals
                            </td>
                            {projectTotalsByDay.map((value, index) => (
                              <td
                                key={`${project.id}-project-total-${index}`}
                                className="px-1 py-2 text-center font-mono"
                              >
                                {formatHours(value)}
                              </td>
                            ))}
                            <td className="px-2 py-2 text-center font-mono">{formatHours(total)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

    </section>
  );
}
