export const DAYS = ["Ma", "Di", "Wo", "Do", "Vr"];
export const DEFAULT_HOUR_TYPE_NAME = "Straight Time";
export const DEFAULT_HOUR_TYPE_ID = "default-straight-time";
const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

export function iso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function mondayOf(date = new Date()) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = copy.getDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  copy.setDate(copy.getDate() + delta);
  return iso(copy);
}

export function addDays(value, days) {
  const date = parseIso(value);
  date.setDate(date.getDate() + days);
  return iso(date);
}

export function shiftWeek(value, weeks) {
  return addDays(value, weeks * 7);
}

export function weekRange(start) {
  return weekSubtitle(start);
}

export function isoWeekNumber(monday) {
  const date = parseIso(monday);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
}

export function weekSubtitle(start) {
  const left = parseIso(start);
  const right = parseIso(addDays(start, 4));
  const sameMonth = left.getMonth() === right.getMonth() && left.getFullYear() === right.getFullYear();
  if (sameMonth) {
    return `${left.getDate()}–${right.getDate()} ${MONTHS[left.getMonth()]} ${left.getFullYear()}`;
  }
  if (left.getFullYear() === right.getFullYear()) {
    return `${left.getDate()} ${MONTHS[left.getMonth()]} – ${right.getDate()} ${MONTHS[right.getMonth()]} ${right.getFullYear()}`;
  }
  return `${left.getDate()} ${MONTHS[left.getMonth()]} ${left.getFullYear()} – ${right.getDate()} ${MONTHS[right.getMonth()]} ${right.getFullYear()}`;
}

export function dayHeading(start, index) {
  return `${DAYS[index]} ${parseIso(addDays(start, index)).getDate()}`;
}

export function formatHours(value) {
  const number = Number(value) || 0;
  if (number === 0) return "";
  if (Number.isInteger(number)) return String(number);
  return String(number).replace(".", ",");
}

export function formatTotal(value) {
  const number = Number(value) || 0;
  if (Number.isInteger(number)) return String(number);
  const snapped = Math.round(number * 2) / 2;
  return String(snapped).replace(".", ",");
}

export function parseHours(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return 0;
  const number = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 24) return null;
  const steps = number / 0.5;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) return null;
  return Math.round(steps) / 2;
}

export function halves(value) {
  return Math.round(Number(value || 0) * 2);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function displayProject(project) {
  const label = project?.label?.trim();
  return label || project?.name || "Project";
}

export function collapse(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function newHourType(name, existing = []) {
  const trimmed = collapse(name);
  if (
    trimmed.toLowerCase() === DEFAULT_HOUR_TYPE_NAME.toLowerCase() &&
    !existing.some((item) => item.id === DEFAULT_HOUR_TYPE_ID)
  ) {
    return { id: DEFAULT_HOUR_TYPE_ID, name: trimmed };
  }
  return { id: uid(), name: trimmed };
}

export function comboKey(projectId, taskId, hourTypeId) {
  return `${projectId}:${taskId}:${hourTypeId}`;
}

export function groupRows(rows, config, customProjects) {
  const configured = new Map((config?.projects ?? []).map((project, index) => [project.id, index]));
  function rank(row) {
    const projectIndex = configured.get(row.projectId);
    if (projectIndex === undefined) {
      const customIndex = customProjects.findIndex((project) => project.id === row.projectId);
      return 100000 + (customIndex === -1 ? 500 : customIndex);
    }
    const project = config.projects[projectIndex];
    const taskIndex = project.tasks.findIndex((task) => task.id === row.taskId);
    const task = taskIndex === -1 ? null : project.tasks[taskIndex];
    const hourIndex = task
      ? task.hourTypes.findIndex((hourType) => hourType.id === row.hourTypeId)
      : 99;
    return projectIndex * 10000 + (taskIndex === -1 ? 99 : taskIndex) * 100 + (hourIndex === -1 ? 99 : hourIndex);
  }
  const sorted = [...rows].sort((left, right) => rank(left) - rank(right));
  const order = [];
  const groups = new Map();
  for (const row of sorted) {
    if (!groups.has(row.projectId)) {
      const project = config?.projects?.find((item) => item.id === row.projectId);
      const custom = customProjects.find((item) => item.id === row.projectId);
      const name = project ? displayProject(project) : custom?.name || row.projectName || "Custom project";
      groups.set(row.projectId, {
        id: row.projectId,
        name,
        configured: Boolean(project),
        rows: [],
      });
      order.push(row.projectId);
    }
    groups.get(row.projectId).rows.push(row);
  }
  return order.map((id) => groups.get(id));
}

export function missingCombos(config, rows) {
  const have = new Set(rows.map((row) => comboKey(row.projectId, row.taskId, row.hourTypeId)));
  const combos = [];
  for (const project of config?.projects ?? []) {
    for (const task of project.tasks) {
      for (const hourType of task.hourTypes) {
        const key = comboKey(project.id, task.id, hourType.id);
        if (have.has(key)) continue;
        combos.push({
          key,
          projectId: project.id,
          projectName: project.name,
          projectLabel: displayProject(project),
          taskId: task.id,
          taskName: task.name,
          hourTypeId: hourType.id,
          hourTypeName: hourType.name,
        });
      }
    }
  }
  return combos;
}
