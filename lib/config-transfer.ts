import { DEFAULT_USER_ID } from "@/lib/constants";
import type { ConfigExportDocument, HourType, Project, Task, UserConfig } from "@/lib/types";
import { safeTrim } from "@/lib/utils";

export const CONFIG_EXPORT_TYPE = "preebs-config";
export const CONFIG_EXPORT_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseHourTypes(value: unknown): HourType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const name = safeTrim(asString(item.name));
      if (!name) {
        return null;
      }

      return {
        id: safeTrim(asString(item.id)),
        name,
      };
    })
    .filter((item): item is HourType => Boolean(item));
}

function parseTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const name = safeTrim(asString(item.name));
      if (!name) {
        return null;
      }

      return {
        id: safeTrim(asString(item.id)),
        name,
        hourTypes: parseHourTypes(item.hourTypes),
      };
    })
    .filter((item): item is Task => Boolean(item));
}

function parseProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const name = safeTrim(asString(item.name));
      if (!name) {
        return null;
      }

      const label = safeTrim(asString(item.label));
      const project: Project = {
        id: safeTrim(asString(item.id)),
        name,
        tasks: parseTasks(item.tasks),
      };
      if (label) {
        project.label = label;
      }
      return project;
    })
    .filter((item): item is Project => Boolean(item));
}

function parseMaxHoursPerDay(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const parsed = typeof item === "number" ? item : Number(item);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((item): item is number => item !== null);
}

export function buildConfigExportDocument(config: UserConfig): ConfigExportDocument {
  return {
    type: CONFIG_EXPORT_TYPE,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
  };
}

export function parseConfigImportPayload(payload: unknown): UserConfig | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload.type !== CONFIG_EXPORT_TYPE || payload.version !== CONFIG_EXPORT_VERSION) {
    return null;
  }

  const rawConfig = payload.config;
  if (!isRecord(rawConfig)) {
    return null;
  }

  return {
    userId: DEFAULT_USER_ID,
    maxHoursPerDay: parseMaxHoursPerDay(rawConfig.maxHoursPerDay),
    projects: parseProjects(rawConfig.projects),
    updatedAt: new Date().toISOString(),
  };
}
