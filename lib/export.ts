import { WEEKDAY_COUNT } from "@/lib/constants";
import { getWeekDates } from "@/lib/date";
import type {
  ExportDayNode,
  ExportHourTypeNode,
  ExportProjectNode,
  ExportTaskNode,
  UserConfig,
  WeekDocument,
  WeekExportDocument,
} from "@/lib/types";

function indexMap(ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  ids.forEach((id, idx) => map.set(id, idx));
  return map;
}

function sortByOrder<T extends { projectId?: string; taskId?: string; hourTypeId?: string }>(
  values: T[],
  projectOrder: Map<string, number>,
  taskOrder: Map<string, number>,
  hourTypeOrder: Map<string, number>,
): T[] {
  return values.sort((a, b) => {
    const p = (projectOrder.get(a.projectId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (projectOrder.get(b.projectId ?? "") ?? Number.MAX_SAFE_INTEGER);
    if (p !== 0) {
      return p;
    }

    const t = (taskOrder.get(a.taskId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (taskOrder.get(b.taskId ?? "") ?? Number.MAX_SAFE_INTEGER);
    if (t !== 0) {
      return t;
    }

    return (hourTypeOrder.get(a.hourTypeId ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (hourTypeOrder.get(b.hourTypeId ?? "") ?? Number.MAX_SAFE_INTEGER);
  });
}

export function buildWeekExport(config: UserConfig, week: WeekDocument): WeekExportDocument {
  const dates = getWeekDates(week.weekStartDate);
  const projectOrder = indexMap(config.projects.map((project) => project.id));
  const taskOrder = indexMap(config.projects.flatMap((project) => project.tasks.map((task) => task.id)));
  const hourTypeOrder = indexMap(
    config.projects.flatMap((project) =>
      project.tasks.flatMap((task) => task.hourTypes.map((hourType) => hourType.id)),
    ),
  );

  const dayNodes: ExportDayNode[] = dates.map((date) => ({
    date,
    projects: [],
    totals: {
      hours: 0,
    },
  }));

  for (let dayIndex = 0; dayIndex < WEEKDAY_COUNT; dayIndex += 1) {
    const projectMap = new Map<string, ExportProjectNode>();

    for (const row of week.rows) {
      const hours = row.hours[dayIndex] ?? 0;
      if (hours <= 0) {
        continue;
      }

      let project = projectMap.get(row.projectId);
      if (!project) {
        project = {
          projectId: row.projectId,
          projectName: row.projectName,
          tasks: [],
        };
        projectMap.set(row.projectId, project);
      }

      let task = project.tasks.find((item) => item.taskId === row.taskId);
      if (!task) {
        task = {
          taskId: row.taskId,
          taskName: row.taskName,
          hourTypes: [],
        };
        project.tasks.push(task);
      }

      let hourType = task.hourTypes.find((item) => item.hourTypeId === row.hourTypeId);
      if (!hourType) {
        hourType = {
          hourTypeId: row.hourTypeId,
          hourTypeName: row.hourTypeName,
          hours: 0,
        };
        task.hourTypes.push(hourType);
      }

      hourType.hours += hours;
      dayNodes[dayIndex].totals.hours += hours;
    }

    dayNodes[dayIndex].projects = sortByOrder(
      Array.from(projectMap.values()),
      projectOrder,
      taskOrder,
      hourTypeOrder,
    ).map((project) => {
      const sortedTasks: ExportTaskNode[] = sortByOrder(
        project.tasks,
        projectOrder,
        taskOrder,
        hourTypeOrder,
      ).map((task) => {
        const sortedHourTypes: ExportHourTypeNode[] = sortByOrder(
          task.hourTypes,
          projectOrder,
          taskOrder,
          hourTypeOrder,
        );
        return {
          ...task,
          hourTypes: sortedHourTypes,
        };
      });

      return {
        ...project,
        tasks: sortedTasks,
      };
    });
  }

  const weekTotal = dayNodes.reduce((sum, day) => sum + day.totals.hours, 0);

  return {
    weekStart: week.weekStartDate,
    weekEnd: week.weekEndDate,
    maxHoursPerDay: config.maxHoursPerDay,
    days: dayNodes,
    totals: {
      hours: weekTotal,
    },
  };
}
