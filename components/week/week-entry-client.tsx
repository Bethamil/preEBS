"use client";

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
import type {
  RecentCombo,
  UserConfig,
  WeekCustomProjectInput,
  WeekDocument,
  WeekRowInput,
} from "@/lib/types";
import { clampHours, cn, formatHours, parseNumberInput, safeTrim } from "@/lib/utils";

const PROJECT_ACCENT_COLORS = [
  "#69E48A",
  "#A36AF0",
  "#DEB163",
  "#8F63DE",
  "#54D477",
  "#C96BA6",
  "#B2A45F",
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
  projectName: string;
  taskId: string;
  taskName: string;
  hourTypeId: string;
  hourTypeName: string;
  hours: number[];
  note?: string;
}

interface LocalCustomProject {
  id: string;
  name: string;
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
  isNew: boolean;
}

interface ProjectSummary {
  projectId: string;
  projectName: string;
  projectEbsName?: string;
  configProject: UserConfig["projects"][number] | null;
  isCustom: boolean;
  accentColor: string;
  projectRows: LocalRow[];
  totalsByDay: number[];
  total: number;
  taskCount: number;
  status: "ok" | "warning";
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

function getProjectDisplayName(project: Pick<UserConfig["projects"][number], "name" | "label">): string {
  const label = safeTrim(project.label ?? "");
  return label || project.name;
}

function toLocalRows(week: WeekDocument): LocalRow[] {
  return week.rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    taskId: row.taskId,
    taskName: row.taskName,
    hourTypeId: row.hourTypeId,
    hourTypeName: row.hourTypeName,
    hours: Array.from({ length: WEEKDAY_COUNT }, (_, index) => clampHours(row.hours[index] ?? 0)),
    note: row.note,
  }));
}

function serializeState(rows: LocalRow[], customProjects: LocalCustomProject[]): string {
  return JSON.stringify(
    {
      rows: rows.map((row) => ({
        ...row,
        hours: row.hours.map((hours) => clampHours(hours)),
      })),
      customProjects: customProjects.map((project) => ({
        id: project.id,
        name: safeTrim(project.name),
      })),
    },
  );
}

function toPayload(rows: LocalRow[]): WeekRowInput[] {
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    taskId: row.taskId,
    taskName: row.taskName,
    hourTypeId: row.hourTypeId,
    hourTypeName: row.hourTypeName,
    hours: row.hours.map((hours) => clampHours(hours)),
    note: row.note,
  }));
}

function toCustomProjectPayload(customProjects: LocalCustomProject[]): WeekCustomProjectInput[] {
  return customProjects.map((project) => ({
    id: project.id,
    name: safeTrim(project.name),
  }));
}

function deriveCustomProjects(week: WeekDocument, configuredProjectIds: Set<string>): LocalCustomProject[] {
  const projectById = new Map<string, LocalCustomProject>();

  for (const project of week.customProjects ?? []) {
    const id = safeTrim(project.id);
    const name = safeTrim(project.name);
    if (!id || configuredProjectIds.has(id)) {
      continue;
    }
    projectById.set(id, { id, name: name || "Custom Project" });
  }

  for (const row of week.rows) {
    if (configuredProjectIds.has(row.projectId) || projectById.has(row.projectId)) {
      continue;
    }
    const id = safeTrim(row.projectId);
    if (!id) {
      continue;
    }
    projectById.set(id, {
      id,
      name: safeTrim(row.projectName) || "Custom Project",
    });
  }

  return Array.from(projectById.values());
}

export function WeekEntryClient({ weekStartDate }: { weekStartDate: string }) {
  const { pushToast } = useToast();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [customProjects, setCustomProjects] = useState<LocalCustomProject[]>([]);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [recentCombos, setRecentCombos] = useState<RecentCombo[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [focusedDayIndex, setFocusedDayIndex] = useState<number | null>(0);
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [pendingCustomProjectDeleteId, setPendingCustomProjectDeleteId] = useState<string | null>(null);

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
    const configuredIds = new Set(data.config.projects.map((project) => project.id));
    const localCustomProjects = deriveCustomProjects(data.week, configuredIds);
    const snapshot = serializeState(localRows, localCustomProjects);

    setConfig(data.config);
    setRows(localRows);
    setCustomProjects(localCustomProjects);
    setRecentCombos(data.recentCombos);
    setLastSavedSnapshot(snapshot);
    setSaveState("idle");
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartDate]);

  const configProjects = config?.projects ?? [];
  const configuredProjectIdSet = useMemo(
    () => new Set(configProjects.map((project) => project.id)),
    [configProjects],
  );
  const allProjectIds = useMemo(
    () => [...configProjects.map((project) => project.id), ...customProjects.map((project) => project.id)],
    [configProjects, customProjects],
  );

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
    if (allProjectIds.length === 0) {
      setOpenProjectIds((current) => (current.length === 0 ? current : []));
      return;
    }

    setOpenProjectIds((current) => {
      const validIds = new Set(allProjectIds);
      const validCurrent = current.filter((projectId) => validIds.has(projectId));
      const unchanged =
        validCurrent.length === current.length &&
        validCurrent.every((projectId, index) => projectId === current[index]);
      if (unchanged) {
        return current;
      }
      return validCurrent;
    });
  }, [allProjectIds]);

  const defaultSelection = useMemo(() => {
    const fallbackProject = configProjects[0];
    const fallbackTask = fallbackProject?.tasks[0];
    const fallbackHourType = fallbackTask?.hourTypes[0];

    return {
      projectId: fallbackProject?.id,
      taskId: fallbackTask?.id,
      hourTypeId: fallbackHourType?.id,
    };
  }, [configProjects]);

  const shouldShowHourType = useMemo(() => {
    const normalizedHourTypeNames = new Set<string>();

    for (const project of configProjects) {
      for (const task of project.tasks) {
        if (task.hourTypes.length !== 1) {
          return true;
        }
        for (const hourType of task.hourTypes) {
          normalizedHourTypeNames.add(hourType.name.trim().toLowerCase());
        }
      }
    }

    for (const row of rows) {
      const normalizedName = row.hourTypeName.trim().toLowerCase();
      if (normalizedName) {
        normalizedHourTypeNames.add(normalizedName);
      }
      if (normalizedHourTypeNames.size > 1) {
        return true;
      }
    }

    return normalizedHourTypeNames.size > 1;
  }, [configProjects, rows]);

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

  useEffect(() => {
    if (!pendingCustomProjectDeleteId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPendingCustomProjectDeleteId(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [pendingCustomProjectDeleteId]);

  const snapshot = useMemo(
    () => serializeState(rows, customProjects),
    [rows, customProjects],
  );

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

  const openVisibleRows = useMemo(() => {
    if (openProjectIds.length === 0) {
      return [];
    }

    const openProjects = new Set(openProjectIds);
    return rows.filter((row) => openProjects.has(row.projectId));
  }, [rows, openProjectIds]);

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
    const summaries: ProjectSummary[] = [];

    for (let index = 0; index < allProjectIds.length; index += 1) {
      const projectId = allProjectIds[index];
      const configProject = configProjects.find((project) => project.id === projectId) ?? null;
      const customProject = customProjects.find((project) => project.id === projectId) ?? null;
      const projectRows = rows.filter((row) => row.projectId === projectId);
      const totals = Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) =>
        projectRows.reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0),
      );
      const total = totals.reduce((sum, value) => sum + value, 0);
      const taskCount = new Set(projectRows.map((row) => row.taskId)).size;
      const latestProjectName = [...projectRows]
        .reverse()
        .find((row) => safeTrim(row.projectName).length > 0)?.projectName;
      const projectDisplayName = configProject
        ? getProjectDisplayName(configProject)
        : customProject?.name ?? latestProjectName ?? "Custom Project";
      const projectEbsName = configProject?.name;

      summaries.push({
        projectId,
        projectName: projectDisplayName,
        projectEbsName,
        configProject,
        isCustom: !configProject,
        accentColor: PROJECT_ACCENT_COLORS[index % PROJECT_ACCENT_COLORS.length],
        projectRows,
        totalsByDay: totals,
        total,
        taskCount,
        status: totals.some((hours, dayIndex) => hours > (maxHoursPerDay[dayIndex] ?? 0) + HOUR_COMPARE_EPSILON)
          ? "warning"
          : "ok",
      });
    }

    return summaries;
  }, [allProjectIds, configProjects, customProjects, rows, maxHoursPerDay]);

  const comboOptions = useMemo(() => {
    const recentKeys = new Set(
      recentCombos.map((combo) => comboKey(combo.projectId, combo.taskId, combo.hourTypeId)),
    );
    const existingKeys = new Set(
      rows.map((row) => comboKey(row.projectId, row.taskId, row.hourTypeId)),
    );

    const options: ComboOption[] = [];

    for (const project of configProjects) {
      const projectDisplayName = getProjectDisplayName(project);
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
              projectName: projectDisplayName,
              taskName: task.name,
              hourTypeName: hourType.name,
            }, shouldShowHourType),
            searchText: shouldShowHourType
              ? `${projectDisplayName} ${project.name} ${task.name} ${hourType.name}`.toLowerCase()
              : `${projectDisplayName} ${project.name} ${task.name}`.toLowerCase(),
            isRecent,
            isNew: !existingKeys.has(comboKey(project.id, task.id, hourType.id)),
          };
          options.push(option);
        }
      }
    }

    return options.sort((left, right) => {
      if (left.isRecent !== right.isRecent) {
        return left.isRecent ? -1 : 1;
      }
      if (left.isNew !== right.isNew) {
        return left.isNew ? 1 : -1;
      }
      return left.label.localeCompare(right.label);
    });
  }, [configProjects, recentCombos, rows, shouldShowHourType]);

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
    const project = configProjects.find((item) => item.id === row.projectId);
    if (!project) {
      return {
        ...row,
        projectName: safeTrim(row.projectName) || "Custom Project",
        taskName: safeTrim(row.taskName),
        hourTypeName: safeTrim(row.hourTypeName) || DEFAULT_HOUR_TYPE_NAME,
      };
    }

    const task = project?.tasks.find((item) => item.id === row.taskId) ?? project?.tasks[0];
    const hourType =
      task?.hourTypes.find((item) => item.id === row.hourTypeId) ??
      task?.hourTypes.find((item) => item.name === DEFAULT_HOUR_TYPE_NAME) ??
      task?.hourTypes[0];

    return {
      ...row,
      projectId: project?.id ?? row.projectId,
      projectName: project?.name ?? row.projectName,
      taskId: task?.id ?? row.taskId,
      taskName: task?.name ?? row.taskName,
      hourTypeId: hourType?.id ?? row.hourTypeId,
      hourTypeName: hourType?.name ?? row.hourTypeName,
    };
  };

  const addRow = (options?: AddRowOptions) => {
    if (!config) {
      return;
    }

    const baseProjectId = options?.overrideProjectId ?? options?.combo?.projectId ?? defaultSelection.projectId;
    if (baseProjectId && !configuredProjectIdSet.has(baseProjectId)) {
      const projectName =
        customProjects.find((project) => project.id === baseProjectId)?.name ??
        rows.find((row) => row.projectId === baseProjectId)?.projectName ??
        "Custom Project";
      const customTaskId = `custom-task:${crypto.randomUUID()}`;
      const customHourTypeId = `custom-hour-type:${crypto.randomUUID()}`;
      const customRow: LocalRow = {
        id: crypto.randomUUID(),
        projectId: baseProjectId,
        projectName,
        taskId: customTaskId,
        taskName: "",
        hourTypeId: customHourTypeId,
        hourTypeName: DEFAULT_HOUR_TYPE_NAME,
        hours: [0, 0, 0, 0, 0],
      };

      rememberEditedProject(baseProjectId);
      setRows((current) => [...current, customRow]);
      window.setTimeout(() => {
        const key = `${customRow.id}:0`;
        const input = inputRefs.current.get(key);
        input?.focus();
        input?.select();
      }, 10);
      return;
    }

    if (configProjects.length === 0) {
      pushToast("No configured projects. Add a custom project instead.", "error");
      return;
    }

    const project = configProjects.find((item) => item.id === baseProjectId) ?? configProjects[0];
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
        rememberEditedProject(existingRow.projectId);
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
      projectName: project.name,
      taskId: selectedTask.id,
      taskName: selectedTask.name,
      hourTypeId: selectedHourType.id,
      hourTypeName: selectedHourType.name,
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

  const addCustomProjectRow = () => {
    const customProjectCount = customProjects.length;
    const projectName =
      customProjectCount === 0 ? "Custom Project" : `Custom Project ${customProjectCount + 1}`;
    const projectId = `custom-project:${crypto.randomUUID()}`;
    rememberEditedProject(projectId);
    setCustomProjects((current) => [...current, { id: projectId, name: projectName }]);
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

  const updateCustomProjectName = (projectId: string, projectName: string) => {
    rememberEditedProject(projectId);
    setCustomProjects((current) =>
      current.map((project) => (project.id === projectId ? { ...project, name: projectName } : project)),
    );
    setRows((current) =>
      current.map((row) => (row.projectId === projectId ? { ...row, projectName } : row)),
    );
  };

  const deleteRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const deleteCustomProject = (projectId: string) => {
    setCustomProjects((current) => current.filter((project) => project.id !== projectId));
    setRows((current) => current.filter((row) => row.projectId !== projectId));
    setOpenProjectIds((current) => current.filter((id) => id !== projectId));
    setPendingCustomProjectDeleteId((current) => (current === projectId ? null : current));
    pushToast("Custom project deleted.", "info");
  };

  const requestCustomProjectDelete = (projectId: string) => {
    if (pendingCustomProjectDeleteId === projectId) {
      deleteCustomProject(projectId);
      return;
    }
    setPendingCustomProjectDeleteId(projectId);
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
      body: JSON.stringify({
        rows: toPayload(rows),
        customProjects: toCustomProjectPayload(customProjects),
      }),
    });

    if (!response.ok) {
      setSaveState("error");
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      pushToast(payload.error ?? "Save failed.", "error");
      return;
    }

    setSaveState("saved");
    setLastSavedSnapshot(serializeState(rows, customProjects));
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
    const localCustomProjects = deriveCustomProjects(data.week, configuredProjectIdSet);
    setRows(localRows);
    setCustomProjects(localCustomProjects);
    setLastSavedSnapshot(serializeState(localRows, localCustomProjects));
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

  const focusExistingComboRow = (combo: Pick<ComboOption, "projectId" | "taskId" | "hourTypeId">): boolean => {
    const existingRow = rows.find(
      (row) =>
        row.projectId === combo.projectId &&
        row.taskId === combo.taskId &&
        row.hourTypeId === combo.hourTypeId,
    );
    if (!existingRow) {
      return false;
    }

    const targetDayIndex = focusedDayIndex ?? 0;
    rememberEditedProject(existingRow.projectId);
    window.setTimeout(() => {
      const key = `${existingRow.id}:${targetDayIndex}`;
      const input = inputRefs.current.get(key);
      input?.focus();
      input?.select();
    }, 10);
    return true;
  };

  const quickAddFromCombo = (combo: ComboOption) => {
    setQuickComboSearch(combo.label);
    if (focusExistingComboRow(combo)) {
      return;
    }

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

  const hasConfigProjects = configProjects.length > 0;

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
                  "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  weekHoursStatus === "match" && "status-ok",
                  weekHoursStatus === "under" && "status-warn",
                  weekHoursStatus === "over" && "status-danger",
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
            <Button variant="secondary" size="sm" onClick={addCustomProjectRow}>
              Add Custom Project
            </Button>
            <Button variant="secondary" size="sm" onClick={copyPrevious}>
              Copy Previous
            </Button>
            <Button variant="ghost" size="sm" onClick={exportJson}>
              Export JSON
            </Button>
          </div>
        </div>

        {exceedsMax && (
          <div className="status-danger mt-3 rounded-xl border px-3 py-2 text-sm">
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
                disabled={!hasConfigProjects}
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
                  !hasConfigProjects
                    ? "Configure projects to use quick add"
                    : shouldShowHourType
                    ? "Search project, task, or hour type..."
                    : "Search project or task..."
                }
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                <kbd className="inline-flex h-6 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-[11px] font-medium text-[var(--color-text-muted)]">
                  ⌘K
                </kbd>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasConfigProjects && quickComboMatches.slice(0, 6).map((combo) => (
              <button
                key={comboKey(combo.projectId, combo.taskId, combo.hourTypeId)}
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2.5 py-1 text-xs text-[var(--color-text-soft)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                onClick={() => quickAddFromCombo(combo)}
                title={combo.label}
              >
                {combo.isRecent && (
                  <span className="rounded-full bg-[var(--color-panel-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    Recent
                  </span>
                )}
                {combo.isNew && (
                  <span className="rounded-full bg-[var(--color-panel-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-accent)]">
                    New
                  </span>
                )}
                <span className="truncate">{combo.label}</span>
              </button>
            ))}
            {!hasConfigProjects && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Quick add shows configured combos. Add projects in Config first.
              </p>
            )}
            {hasConfigProjects && quickComboMatches.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">No combo matches this search.</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {WEEKDAY_LABELS.map((label, index) => {
            const dayTotal = formatHours(totalsByDay[index]);
            const dayMax = formatHours(maxHoursPerDay[index]);

            return (
              <div
                key={label}
                className={cn(
                  "flex min-h-28 cursor-pointer flex-col rounded-xl border px-3 py-2.5 transition hover:border-[var(--color-ring)]",
                  exceededDayIndexSet.has(index)
                    ? "status-danger"
                    : exactDayIndexSet.has(index)
                      ? "status-ok"
                      : "border-[var(--color-border)] bg-[var(--color-panel-strong)]",
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
                <div className="flex items-start justify-between gap-2">
                  <div className="text-left">
                    <p className="text-xl font-bold uppercase tracking-[0.04em] leading-none">{label}</p>
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{formatDateLabel(weekDates[index])}</p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] transition hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearDay(index);
                    }}
                    aria-label={`Clear ${label}`}
                    title={`Clear ${label}`}
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
                      <path
                        d="M3 4h10M6.1 2.8h3.8M5.3 4v8.2c0 .5.4.9.9.9h3.6c.5 0 .9-.4.9-.9V4"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M7 6.4v4.2M9 6.4v4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="mt-auto flex items-end justify-between gap-2">
                  <p className="text-lg font-semibold leading-none">{dayTotal}h</p>
                  <p className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    Max {dayMax}h
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="space-y-3">
        {projectSummaries.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              No rows yet. Add a configured row or a custom project to start this week.
            </p>
          </Card>
        )}
        {projectSummaries.map((summary) => {
          const {
            projectId,
            projectName,
            projectEbsName,
            configProject,
            isCustom,
            accentColor,
            projectRows,
            totalsByDay: projectTotalsByDay,
            total,
            taskCount,
            status,
          } = summary;
          const isExpanded = openProjectIds.includes(projectId);
          const visibleRowCount = projectRows.length;

          return (
            <section
              key={projectId}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]"
              style={{ borderLeftColor: accentColor, borderLeftWidth: "4px" }}
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="w-full min-w-0 text-left"
                    onClick={() => toggleProjectOpen(projectId)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: accentColor }}
                        aria-hidden
                      />
                      <h3 className="truncate text-base font-semibold">{projectName}</h3>
                      {isCustom && (
                        <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-soft)]">
                          Custom
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                          status === "warning" ? "status-warn" : "status-ok",
                        )}
                      >
                        {status === "warning" ? "Warning" : "OK"}
                      </span>
                    </div>
                    {!isCustom &&
                      projectEbsName &&
                      safeTrim(projectEbsName) !== safeTrim(projectName) && (
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          EBS: {projectEbsName}
                        </p>
                      )}
                  </button>
                  {isCustom && (
                    <div className="mt-2 max-w-xs">
                      <Input
                        aria-label="Custom project name"
                        value={projectName}
                        onChange={(event) => updateCustomProjectName(projectId, event.target.value)}
                        className="h-9 rounded-lg px-2 text-sm"
                      />
                    </div>
                  )}
                  <div
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    aria-label={`${projectName} daily totals`}
                  >
                    {WEEKDAY_LABELS.map((label, index) => {
                      const dayTotal = projectTotalsByDay[index] ?? 0;
                      return (
                        <span
                          key={`${projectId}-${label}-header-total`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]",
                            dayTotal > 0
                              ? "border-[var(--color-border-strong)] bg-[var(--color-panel-strong)] text-[var(--color-text-soft)]"
                              : "border-[var(--color-border)] text-[var(--color-text-muted)]",
                          )}
                        >
                          <span>{label}</span>
                          <span className="font-mono text-[11px] normal-case">{formatHours(dayTotal)}h</span>
                        </span>
                      );
                    })}
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-soft)]">
                      <span>Total</span>
                      <span className="font-mono text-[11px] normal-case">{formatHours(total)}h</span>
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {taskCount} task{taskCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => addRow({ overrideProjectId: projectId })}>
                    Add Task
                  </Button>
                  {isCustom && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn(
                        pendingCustomProjectDeleteId === projectId &&
                          "border border-[var(--color-danger)] bg-[var(--color-danger)] text-[#22050f] hover:bg-[var(--color-danger)] hover:text-[#22050f]",
                      )}
                      onClick={() => requestCustomProjectDelete(projectId)}
                    >
                      {pendingCustomProjectDeleteId === projectId ? "Confirm Delete" : "Delete Project"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleProjectOpen(projectId)}
                  >
                    {isExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
              </header>

              {isExpanded && (
                <div className="p-2 sm:p-3">
                  {visibleRowCount === 0 ? (
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
                      No rows yet for this project.
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
                              <th key={`${projectId}-${label}`} className="px-1 py-2 font-medium">
                                <button
                                  type="button"
                                  className={cn(
                                    "w-full rounded-md px-1 py-1 text-left text-[10px] transition",
                                    focusedDayIndex === index &&
                                      "bg-[rgba(105,228,138,0.16)] text-[var(--color-accent)]",
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
                          {projectRows.map((row) => {
                            const configuredTask = configProject?.tasks.find((item) => item.id === row.taskId);
                            const task = configuredTask ?? null;
                            const hourTypes = task?.hourTypes ?? [
                              { id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME },
                            ];
                            const selectedHourTypeName =
                              hourTypes.find((item) => item.id === row.hourTypeId)?.name ?? row.hourTypeName;
                            const rowTotal = row.hours.reduce((sum, hours) => sum + hours, 0);

                            return (
                              <tr
                                key={row.id}
                                className="border-t border-[var(--color-border)] align-middle"
                              >
                                <td className="px-2 py-1.5">
                                  {configProject ? (
                                    <Select
                                      aria-label="Task"
                                      title={task?.name ?? ""}
                                      value={row.taskId}
                                      className="h-9 rounded-lg px-2 text-sm"
                                      onChange={(event) => {
                                        const nextTask = configProject.tasks.find(
                                          (item) => item.id === event.target.value,
                                        );
                                        const nextHourType =
                                          nextTask?.hourTypes.find(
                                            (type) => type.name === DEFAULT_HOUR_TYPE_NAME,
                                          ) ?? nextTask?.hourTypes[0];

                                        updateRow(
                                          row.id,
                                          (current) => ({
                                            ...current,
                                            taskId: event.target.value,
                                            taskName: nextTask?.name ?? current.taskName,
                                            hourTypeId: nextHourType?.id ?? current.hourTypeId,
                                            hourTypeName: nextHourType?.name ?? current.hourTypeName,
                                          }),
                                          row.projectId,
                                        );
                                      }}
                                    >
                                      {configProject.tasks.map((taskItem) => (
                                        <option key={taskItem.id} value={taskItem.id}>
                                          {taskItem.name}
                                        </option>
                                      ))}
                                    </Select>
                                  ) : (
                                    <Input
                                      aria-label="Task"
                                      value={row.taskName}
                                      onChange={(event) =>
                                        updateRow(
                                          row.id,
                                          (current) => ({
                                            ...current,
                                            taskName: event.target.value,
                                          }),
                                          row.projectId,
                                        )
                                      }
                                      className="h-9 rounded-lg px-2 text-sm"
                                    />
                                  )}
                                </td>
                                {shouldShowHourType && (
                                  <td className="px-2 py-1.5">
                                    {configProject ? (
                                      <Select
                                        aria-label="Hour Type"
                                        title={selectedHourTypeName}
                                        value={row.hourTypeId}
                                        className="h-9 rounded-lg px-2 text-sm"
                                        onChange={(event) => {
                                          const nextHourType = hourTypes.find(
                                            (hourType) => hourType.id === event.target.value,
                                          );
                                          updateRow(
                                            row.id,
                                            (current) => ({
                                              ...current,
                                              hourTypeId: event.target.value,
                                              hourTypeName: nextHourType?.name ?? current.hourTypeName,
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
                                    ) : (
                                      <Input
                                        aria-label="Hour Type"
                                        value={row.hourTypeName}
                                        onChange={(event) =>
                                          updateRow(
                                            row.id,
                                            (current) => ({
                                              ...current,
                                              hourTypeName: event.target.value,
                                            }),
                                            row.projectId,
                                          )
                                        }
                                        className="h-9 rounded-lg px-2 text-sm"
                                      />
                                    )}
                                  </td>
                                )}
                                {Array.from({ length: WEEKDAY_COUNT }, (_, dayIndex) => (
                                  <td
                                    key={`${row.id}-${dayIndex}`}
                                    className={cn(
                                      "px-1 py-1.5",
                                      focusedDayIndex === dayIndex && "bg-[rgba(105,228,138,0.14)]",
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
                                  <DeleteIconButton
                                    label="Delete task"
                                    confirm={rowTotal > 0}
                                    confirmLabel="Confirm delete task with hours"
                                    onClick={() => deleteRow(row.id)}
                                  />
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
                                key={`${projectId}-project-total-${index}`}
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
