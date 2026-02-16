import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_HOUR_TYPE_ID,
  DEFAULT_HOUR_TYPE_NAME,
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  WEEKDAY_COUNT,
} from "@/lib/constants";
import { getWeekEndDate } from "@/lib/date";
import type {
  DatabaseDocument,
  IsoDateString,
  Project,
  RecentCombo,
  User,
  UserConfig,
  WeekCustomProject,
  WeekCustomProjectInput,
  WeekDocument,
  WeekRowInput,
  WeekSummary,
} from "@/lib/types";
import { clampHours, safeTrim } from "@/lib/utils";

function resolveDbPath(): string {
  const explicitPath = process.env.PREEBS_DB_PATH?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const explicitDataDir = process.env.PREEBS_DATA_DIR?.trim();
  if (explicitDataDir) {
    return path.join(path.resolve(explicitDataDir), "preebs-db.json");
  }

  return path.join(process.cwd(), "data", "preebs-db.json");
}

const DB_PATH = resolveDbPath();

let writeQueue: Promise<unknown> = Promise.resolve();
const DEFAULT_MAX_HOURS_PER_DAY = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function weekKey(userId: string, weekStartDate: IsoDateString): string {
  return `${userId}:${weekStartDate}`;
}

function defaultUser(): User {
  return {
    id: DEFAULT_USER_ID,
    name: DEFAULT_USER_NAME,
    createdAt: nowIso(),
  };
}

export function createEmptyConfig(userId: string = DEFAULT_USER_ID): UserConfig {
  return {
    userId,
    maxHoursPerDay: Array.from({ length: WEEKDAY_COUNT }, () => DEFAULT_MAX_HOURS_PER_DAY),
    projects: [],
    updatedAt: nowIso(),
  };
}

function createDefaultDb(): DatabaseDocument {
  return {
    users: [defaultUser()],
    configs: {
      [DEFAULT_USER_ID]: createEmptyConfig(DEFAULT_USER_ID),
    },
    weeks: {},
  };
}

async function ensureDbFile(): Promise<void> {
  const dir = path.dirname(DB_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(createDefaultDb(), null, 2), "utf-8");
  }
}

async function readDb(): Promise<DatabaseDocument> {
  await ensureDbFile();
  const raw = await fs.readFile(DB_PATH, "utf-8");
  if (!raw.trim()) {
    return createDefaultDb();
  }
  const parsed = JSON.parse(raw) as Partial<DatabaseDocument>;
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [defaultUser()],
    configs: parsed.configs ?? { [DEFAULT_USER_ID]: createEmptyConfig(DEFAULT_USER_ID) },
    weeks: parsed.weeks ?? {},
  };
}

async function writeDb(db: DatabaseDocument): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

async function withWriteLock<T>(job: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(job, job);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeSingleHourType(
  taskHourTypes: { id: string; name: string }[],
): { id: string; name: string }[] {
  if (taskHourTypes.length === 0) {
    return [{ id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME }];
  }

  const preferred = taskHourTypes.find(
    (type) => type.name.trim().toLowerCase() !== DEFAULT_HOUR_TYPE_NAME.toLowerCase(),
  ) ?? taskHourTypes[0];

  return [{ id: preferred.id || randomUUID(), name: preferred.name }];
}

function normalizeProject(project: Project): Project {
  const projectName = safeTrim(project.name);
  const projectLabel = safeTrim(project.label ?? "");
  const tasks = project.tasks
    .map((task) => {
      const taskName = safeTrim(task.name);
      const validHourTypes = task.hourTypes
        .map((hourType) => ({
          id: hourType.id || randomUUID(),
          name: safeTrim(hourType.name),
        }))
        .filter((hourType) => hourType.name.length > 0);

      if (!taskName) {
        return null;
      }

      return {
        id: task.id || randomUUID(),
        name: taskName,
        hourTypes: normalizeSingleHourType(validHourTypes),
      };
    })
    .filter((task): task is NonNullable<typeof task> => Boolean(task));

  return {
    id: project.id || randomUUID(),
    name: projectName,
    label: projectLabel || undefined,
    tasks,
  };
}

export function normalizeConfig(config: UserConfig): UserConfig {
  const maxHoursPerDay = Array.from({ length: WEEKDAY_COUNT }, (_, index) => {
    const value = config.maxHoursPerDay?.[index];
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_HOURS_PER_DAY;
    }
    return clampHours(value);
  });

  const projects = config.projects
    .map(normalizeProject)
    .filter((project) => project.name.length > 0);

  return {
    userId: config.userId || DEFAULT_USER_ID,
    maxHoursPerDay,
    projects,
    updatedAt: nowIso(),
  };
}

function ensureUser(db: DatabaseDocument, userId: string): void {
  if (!db.users.some((user) => user.id === userId)) {
    db.users.push({
      id: userId,
      name: userId === DEFAULT_USER_ID ? DEFAULT_USER_NAME : userId,
      createdAt: nowIso(),
    });
  }
  if (!db.configs[userId]) {
    db.configs[userId] = createEmptyConfig(userId);
  }
}

export async function getConfig(userId: string = DEFAULT_USER_ID): Promise<UserConfig> {
  const db = await readDb();
  ensureUser(db, userId);
  const config = db.configs[userId] ?? createEmptyConfig(userId);
  if (!db.configs[userId]) {
    await writeDb(db);
  }
  return normalizeConfig(config);
}

export async function saveConfig(
  config: UserConfig,
  userId: string = DEFAULT_USER_ID,
): Promise<UserConfig> {
  return withWriteLock(async () => {
    const db = await readDb();
    ensureUser(db, userId);

    const normalized = normalizeConfig({
      ...config,
      userId,
    });
    db.configs[userId] = normalized;
    await writeDb(db);
    return normalized;
  });
}

function buildRowNameMaps(config: UserConfig): {
  projectMap: Map<string, { id: string; name: string }>;
  taskMap: Map<string, { id: string; name: string }>;
  hourTypeMap: Map<string, { id: string; name: string }>;
  taskIdsByProject: Map<string, Set<string>>;
  hourTypeIdsByTask: Map<string, Set<string>>;
} {
  const projectMap = new Map<string, { id: string; name: string }>();
  const taskMap = new Map<string, { id: string; name: string }>();
  const hourTypeMap = new Map<string, { id: string; name: string }>();
  const taskIdsByProject = new Map<string, Set<string>>();
  const hourTypeIdsByTask = new Map<string, Set<string>>();

  for (const project of config.projects) {
    projectMap.set(project.id, { id: project.id, name: project.name });
    taskIdsByProject.set(project.id, new Set(project.tasks.map((task) => task.id)));
    for (const task of project.tasks) {
      taskMap.set(task.id, { id: task.id, name: task.name });
      hourTypeIdsByTask.set(task.id, new Set(task.hourTypes.map((hourType) => hourType.id)));
      for (const hourType of task.hourTypes) {
        hourTypeMap.set(hourType.id, { id: hourType.id, name: hourType.name });
      }
    }
  }

  return {
    projectMap,
    taskMap,
    hourTypeMap,
    taskIdsByProject,
    hourTypeIdsByTask,
  };
}

function normalizeWeekRows(
  rows: WeekRowInput[],
  config: UserConfig,
  customProjectNameMap: Map<string, string>,
): WeekDocument["rows"] {
  const {
    projectMap,
    taskMap,
    hourTypeMap,
    taskIdsByProject,
    hourTypeIdsByTask,
  } = buildRowNameMaps(config);

  const normalizedRows = rows
    .map((row) => {
      const projectId = safeTrim(row.projectId);
      const taskId = safeTrim(row.taskId);
      const hourTypeId = safeTrim(row.hourTypeId);
      if (!projectId || !taskId || !hourTypeId) {
        return null;
      }

      const projectRef = projectMap.get(projectId);
      const taskRef = taskMap.get(taskId);
      const hourTypeRef = hourTypeMap.get(hourTypeId);
      const isKnownConfigCombo = Boolean(
        projectRef &&
          taskRef &&
          hourTypeRef &&
          taskIdsByProject.get(projectId)?.has(taskId) &&
          hourTypeIdsByTask.get(taskId)?.has(hourTypeId),
      );

      const projectName = isKnownConfigCombo
        ? projectRef?.name ?? ""
        : safeTrim(row.projectName ?? "") || customProjectNameMap.get(projectId) || "Custom Project";
      const taskName = isKnownConfigCombo ? taskRef?.name ?? "" : safeTrim(row.taskName ?? "");
      const hourTypeName = isKnownConfigCombo
        ? hourTypeRef?.name ?? ""
        : safeTrim(row.hourTypeName ?? "") || DEFAULT_HOUR_TYPE_NAME;
      if (!projectName || !hourTypeName) {
        return null;
      }

      const hours = Array.from({ length: WEEKDAY_COUNT }, (_, index) =>
        clampHours(row.hours[index] ?? 0),
      );

      return {
        id: row.id || randomUUID(),
        projectId,
        projectName,
        taskId,
        taskName,
        hourTypeId,
        hourTypeName,
        hours,
        note: row.note ? safeTrim(row.note) : undefined,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const byCombo = new Map<string, WeekDocument["rows"][number]>();
  const order: string[] = [];

  for (const row of normalizedRows) {
    const key = `${row.projectId}:${row.taskId}:${row.hourTypeId}`;
    const existing = byCombo.get(key);

    if (!existing) {
      byCombo.set(key, row);
      order.push(key);
      continue;
    }

    byCombo.set(key, {
      ...existing,
      hours: Array.from({ length: WEEKDAY_COUNT }, (_, index) =>
        clampHours((existing.hours[index] ?? 0) + (row.hours[index] ?? 0)),
      ),
      note: existing.note ?? row.note,
    });
  }

  return order
    .map((key) => byCombo.get(key))
    .filter((row): row is WeekDocument["rows"][number] => Boolean(row));
}

function normalizeCustomProjects(
  customProjects: WeekCustomProjectInput[] | undefined,
  rows: WeekDocument["rows"],
  config: UserConfig,
): WeekCustomProject[] {
  const configuredProjectIds = new Set(config.projects.map((project) => project.id));
  const byId = new Map<string, WeekCustomProject>();
  const order: string[] = [];

  for (const project of customProjects ?? []) {
    const id = safeTrim(project.id);
    const name = safeTrim(project.name) || "Custom Project";
    if (!id || configuredProjectIds.has(id) || byId.has(id)) {
      continue;
    }
    byId.set(id, { id, name });
    order.push(id);
  }

  for (const row of rows) {
    if (configuredProjectIds.has(row.projectId) || byId.has(row.projectId)) {
      continue;
    }
    const id = safeTrim(row.projectId);
    const name = safeTrim(row.projectName);
    if (!id || !name) {
      continue;
    }
    byId.set(id, { id, name });
    order.push(id);
  }

  return order
    .map((id) => byId.get(id))
    .filter((project): project is WeekCustomProject => Boolean(project));
}

function totalWeekHours(week: WeekDocument): number {
  return week.rows.reduce(
    (weekTotal, row) => weekTotal + row.hours.reduce((rowTotal, hours) => rowTotal + hours, 0),
    0,
  );
}

function requiredWeeklyHours(config: UserConfig): number {
  return config.maxHoursPerDay.reduce((sum, hours) => sum + hours, 0);
}

function includeWeekInSearch(week: WeekDocument, query: string): boolean {
  if (!query) {
    return true;
  }
  const lower = query.toLowerCase();
  if (week.weekStartDate.includes(lower) || week.weekEndDate.includes(lower)) {
    return true;
  }
  return week.rows.some(
    (row) =>
      row.projectName.toLowerCase().includes(lower) ||
      row.taskName.toLowerCase().includes(lower) ||
      row.hourTypeName.toLowerCase().includes(lower),
  );
}

export async function getWeek(
  weekStartDate: IsoDateString,
  userId: string = DEFAULT_USER_ID,
): Promise<WeekDocument | null> {
  const db = await readDb();
  ensureUser(db, userId);
  return db.weeks[weekKey(userId, weekStartDate)] ?? null;
}

export async function saveWeek(
  weekStartDate: IsoDateString,
  rows: WeekRowInput[],
  customProjects: WeekCustomProjectInput[] = [],
  userId: string = DEFAULT_USER_ID,
): Promise<WeekDocument> {
  return withWriteLock(async () => {
    const db = await readDb();
    ensureUser(db, userId);

    const config = normalizeConfig(db.configs[userId] ?? createEmptyConfig(userId));
    db.configs[userId] = config;

    const key = weekKey(userId, weekStartDate);
    const existing = db.weeks[key];
    const now = nowIso();
    const customProjectNameMap = new Map<string, string>(
      customProjects
        .map((project) => ({ id: safeTrim(project.id), name: safeTrim(project.name) || "Custom Project" }))
        .filter((project) => project.id.length > 0)
        .map((project) => [project.id, project.name]),
    );
    const normalizedRows = normalizeWeekRows(rows, config, customProjectNameMap);
    const normalizedCustomProjects = normalizeCustomProjects(customProjects, normalizedRows, config);

    const document: WeekDocument = {
      id: existing?.id ?? key,
      userId,
      weekStartDate,
      weekEndDate: getWeekEndDate(weekStartDate),
      customProjects: normalizedCustomProjects,
      rows: normalizedRows,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    db.weeks[key] = document;
    await writeDb(db);
    return document;
  });
}

export async function copyPreviousWeek(
  weekStartDate: IsoDateString,
  previousWeekStartDate: IsoDateString,
  userId: string = DEFAULT_USER_ID,
): Promise<WeekDocument | null> {
  return withWriteLock(async () => {
    const db = await readDb();
    ensureUser(db, userId);

    const previous = db.weeks[weekKey(userId, previousWeekStartDate)];
    if (!previous) {
      return null;
    }

    const key = weekKey(userId, weekStartDate);
    const existing = db.weeks[key];
    const now = nowIso();

    const copiedRows = previous.rows.map((row) => ({
      ...row,
      id: randomUUID(),
    }));

    const copied: WeekDocument = {
      id: existing?.id ?? key,
      userId,
      weekStartDate,
      weekEndDate: getWeekEndDate(weekStartDate),
      customProjects: previous.customProjects ?? [],
      rows: copiedRows,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    db.weeks[key] = copied;
    await writeDb(db);
    return copied;
  });
}

export async function listWeekSummaries(
  userId: string = DEFAULT_USER_ID,
  query: string = "",
): Promise<WeekSummary[]> {
  const db = await readDb();
  ensureUser(db, userId);
  const config = normalizeConfig(db.configs[userId] ?? createEmptyConfig(userId));
  const requiredHours = requiredWeeklyHours(config);

  return Object.values(db.weeks)
    .filter((week) => week.userId === userId)
    .filter((week) => includeWeekInSearch(week, query))
    .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))
    .map((week) => {
      const hours = totalWeekHours(week);
      const hoursDelta = hours - requiredHours;
      return {
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        totalHours: hours,
        requiredHours,
        hoursDelta,
        hoursStatus: hoursDelta === 0 ? "match" : hoursDelta < 0 ? "under" : "over",
        updatedAt: week.updatedAt,
      };
    });
}

export async function deleteWeek(
  weekStartDate: IsoDateString,
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  return withWriteLock(async () => {
    const db = await readDb();
    delete db.weeks[weekKey(userId, weekStartDate)];
    await writeDb(db);
  });
}

export async function getRecentCombos(
  userId: string = DEFAULT_USER_ID,
  limit: number = 8,
): Promise<RecentCombo[]> {
  const db = await readDb();
  const seen = new Set<string>();
  const items: RecentCombo[] = [];

  const weeks = Object.values(db.weeks)
    .filter((week) => week.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const week of weeks) {
    for (const row of week.rows) {
      const key = `${row.projectId}:${row.taskId}:${row.hourTypeId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        projectId: row.projectId,
        projectName: row.projectName,
        taskId: row.taskId,
        taskName: row.taskName,
        hourTypeId: row.hourTypeId,
        hourTypeName: row.hourTypeName,
      });
      if (items.length >= limit) {
        return items;
      }
    }
  }

  return items;
}
