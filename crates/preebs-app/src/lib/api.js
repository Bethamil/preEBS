import { invoke } from "@tauri-apps/api/core";

export function inTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export const api = {
  info: () => invoke("app_info"),
  revision: () => invoke("revision"),
  getConfig: () => invoke("get_config"),
  saveConfig: (config) => invoke("save_config", { config }),
  removeTask: (id) => invoke("remove_task", { id }),
  setSettings: (maxHours, defaultHourTypeName) =>
    invoke("set_settings", { maxHours, defaultHourTypeName }),
  weekView: (date) => invoke("week_view", { date }),
  saveWeek: (date, rows, customProjects) => invoke("save_week", { date, rows, customProjects }),
  listWeeks: (query = "") => invoke("list_weeks", { query }),
  deleteWeek: (date) => invoke("delete_week", { date }),
  copyPrevious: (date) => invoke("copy_previous_week", { date }),
  exportWeekText: (date) => invoke("export_week_text", { date }),
  exportConfigText: () => invoke("export_config_text"),
  importConfigText: (text) => invoke("import_config_text", { text }),
  writeExportFile: (path, contents) => invoke("write_export_file", { path, contents }),
  readTextFile: (path) => invoke("read_text_file", { path }),
  migrate: (path) => invoke("migrate_from", { path }),
};

export function errorText(error) {
  if (!error) return "Something went wrong";
  if (typeof error === "string") return error;
  return error.message || String(error);
}
