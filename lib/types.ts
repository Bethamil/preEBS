export type IsoDateString = string;

export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface HourType {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  name: string;
  hourTypes: HourType[];
}

export interface Project {
  id: string;
  name: string;
  tasks: Task[];
}

export interface UserConfig {
  userId: string;
  maxHoursPerWeek: number;
  blockOnMaxHoursExceed: boolean;
  projects: Project[];
  updatedAt: string;
}

export interface StoredWeekRow {
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

export interface WeekDocument {
  id: string;
  userId: string;
  weekStartDate: IsoDateString;
  weekEndDate: IsoDateString;
  rows: StoredWeekRow[];
  createdAt: string;
  updatedAt: string;
}

export interface WeekRowInput {
  id?: string;
  projectId: string;
  taskId: string;
  hourTypeId: string;
  hours: number[];
  note?: string;
}

export interface WeekSummary {
  weekStartDate: IsoDateString;
  weekEndDate: IsoDateString;
  totalHours: number;
  exceededMaxHours: boolean;
  updatedAt: string;
}

export interface RecentCombo {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  hourTypeId: string;
  hourTypeName: string;
}

export interface DatabaseDocument {
  users: User[];
  configs: Record<string, UserConfig>;
  weeks: Record<string, WeekDocument>;
}

export interface ExportHourTypeNode {
  hourTypeId: string;
  hourTypeName: string;
  hours: number;
}

export interface ExportTaskNode {
  taskId: string;
  taskName: string;
  hourTypes: ExportHourTypeNode[];
}

export interface ExportProjectNode {
  projectId: string;
  projectName: string;
  tasks: ExportTaskNode[];
}

export interface ExportDayNode {
  date: IsoDateString;
  projects: ExportProjectNode[];
  totals: {
    hours: number;
  };
}

export interface WeekExportDocument {
  weekStart: IsoDateString;
  weekEnd: IsoDateString;
  maxHoursPerWeek: number;
  days: ExportDayNode[];
  totals: {
    hours: number;
  };
}
