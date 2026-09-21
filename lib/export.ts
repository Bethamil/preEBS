import { WEEKDAY_COUNT } from "@/lib/constants";
import { getWeekDates } from "@/lib/date";
import type {
  ExportHourTypeNode,
  UserConfig,
  WeekDocument,
  WeekExportDocument,
} from "@/lib/types";
import { formatHours } from "@/lib/utils";

interface DraftHourType {
  hourTypeId: string;
  hourTypeName: string;
  hours: number;
}

interface DraftTask {
  taskId: string;
  taskName: string;
  hourTypes: DraftHourType[];
}

interface DraftProject {
  projectId: string;
  projectName: string;
  tasks: DraftTask[];
}

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

  const dayNodes = dates.map((date) => ({
    date,
    projects: [] as DraftProject[],
    totals: {
      hours: 0,
    },
  }));

  for (let dayIndex = 0; dayIndex < WEEKDAY_COUNT; dayIndex += 1) {
    const projectMap = new Map<string, DraftProject>();

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
      const sortedTasks: DraftTask[] = sortByOrder(
        project.tasks,
        projectOrder,
        taskOrder,
        hourTypeOrder,
      ).map((task) => {
        const sortedHourTypes: DraftHourType[] = sortByOrder(
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
    maxHoursPerDay: config.maxHoursPerDay.map((hours) => formatHours(hours)),
    days: dayNodes.map((day) => ({
      date: day.date,
      projects: day.projects.map((project) => ({
        projectId: project.projectId,
        projectName: project.projectName,
        tasks: project.tasks.map((task) => ({
          taskId: task.taskId,
          taskName: task.taskName,
          hourTypes: task.hourTypes.map(
            (hourType): ExportHourTypeNode => ({
              hourTypeId: hourType.hourTypeId,
              hourTypeName: hourType.hourTypeName,
              hours: formatHours(hourType.hours),
            }),
          ),
        })),
      })),
      totals: {
        hours: formatHours(day.totals.hours),
      },
    })),
    totals: {
      hours: formatHours(weekTotal),
    },
  };
}
