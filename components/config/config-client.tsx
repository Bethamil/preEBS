"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteIconButton } from "@/components/ui/delete-icon-button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_HOUR_TYPE_ID,
  DEFAULT_HOUR_TYPE_NAME,
  WEEKDAY_LABELS,
} from "@/lib/constants";
import type { Project, UserConfig } from "@/lib/types";
import { cn, formatHours } from "@/lib/utils";

const PROJECT_ACCENT_COLORS = [
  "#69E48A",
  "#A36AF0",
  "#DEB163",
  "#8F63DE",
  "#54D477",
  "#C96BA6",
  "#B2A45F",
] as const;

interface ConfigResponse {
  config: UserConfig;
}

function createBlankProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: "New EBS Project",
    label: "",
    tasks: [],
  };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function configSnapshot(config: UserConfig): string {
  return JSON.stringify(config);
}

function normalizeSingleHourType(
  hourTypes: Array<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const customMatch = hourTypes.find(
    (hourType) =>
      hourType.name.trim().length > 0 &&
      hourType.name.trim().toLowerCase() !== DEFAULT_HOUR_TYPE_NAME.toLowerCase(),
  );
  const defaultMatch = hourTypes.find(
    (hourType) => hourType.name.trim().toLowerCase() === DEFAULT_HOUR_TYPE_NAME.toLowerCase(),
  );
  const fallback = customMatch ?? defaultMatch ?? { id: crypto.randomUUID(), name: DEFAULT_HOUR_TYPE_NAME };

  return [
    {
      id: fallback.id || crypto.randomUUID(),
      name: fallback.name.trim() || DEFAULT_HOUR_TYPE_NAME,
    },
  ];
}

function normalizeConfigToSingleHourType(config: UserConfig): UserConfig {
  return {
    ...config,
    projects: config.projects.map((project) => ({
      ...project,
      tasks: project.tasks.map((task) => ({
        ...task,
        hourTypes: normalizeSingleHourType(task.hourTypes),
      })),
    })),
  };
}

export function ConfigClient() {
  const { pushToast } = useToast();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState("");
  const [search, setSearch] = useState("");
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [collapsedHourTypeMap, setCollapsedHourTypeMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const response = await fetch("/api/config", { cache: "no-store" });
      const data = (await response.json()) as ConfigResponse;
      const normalized = normalizeConfigToSingleHourType(data.config);
      setConfig(normalized);
      setLastSavedSnapshot(configSnapshot(normalized));
      setOpenProjectIds(normalized.projects[0]?.id ? [normalized.projects[0].id] : []);
      setLoading(false);
    };
    run();
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, saving, lastSavedSnapshot]);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (config.projects.length === 0) {
      setOpenProjectIds((current) => (current.length === 0 ? current : []));
      return;
    }

    setOpenProjectIds((current) => {
      const validCurrent = current.filter((projectId) =>
        config.projects.some((project) => project.id === projectId),
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

      const fallbackId = config.projects[0].id;
      return current.length === 1 && current[0] === fallbackId ? current : [fallbackId];
    });
  }, [config]);

  const projectCount = config?.projects.length ?? 0;
  const weeklyConfiguredMax = useMemo(
    () => config?.maxHoursPerDay.reduce((sum, value) => sum + value, 0) ?? 0,
    [config],
  );

  const totalTaskCount = useMemo(
    () => config?.projects.reduce((sum, project) => sum + project.tasks.length, 0) ?? 0,
    [config],
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!config) {
      return false;
    }
    return configSnapshot(config) !== lastSavedSnapshot;
  }, [config, lastSavedSnapshot]);

  const filteredProjects = useMemo(() => {
    if (!config) {
      return [];
    }
    const query = search.trim().toLowerCase();
    if (!query) {
      return config.projects;
    }

    const tokens = query.split(/\s+/).filter(Boolean);
    return config.projects.filter((project) => {
      const nested = project.tasks
        .map((task) => `${task.name} ${task.hourTypes.map((hourType) => hourType.name).join(" ")}`)
        .join(" ");
      const haystack = `${project.label ?? ""} ${project.name} ${nested}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [config, search]);

  const addProject = () => {
    const nextProject = createBlankProject();
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: [...current.projects, nextProject],
      };
    });
    setOpenProjectIds((current) => [...current, nextProject.id]);
  };

  const updateProjectName = (projectId: string, name: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId ? { ...project, name } : project,
        ),
      };
    });
  };

  const updateProjectLabel = (projectId: string, label: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId ? { ...project, label } : project,
        ),
      };
    });
  };

  const removeProject = (projectId: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.filter((project) => project.id !== projectId),
      };
    });
  };

  const reorderProject = (projectIndex: number, direction: -1 | 1) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: moveItem(current.projects, projectIndex, projectIndex + direction),
      };
    });
  };

  const addTask = (projectId: string) => {
    const taskId = crypto.randomUUID();
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.id !== projectId) {
            return project;
          }
          return {
            ...project,
            tasks: [
              ...project.tasks,
              {
                id: taskId,
                name: "New Task",
                hourTypes: [{ id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME }],
              },
            ],
          };
        }),
      };
    });
    setOpenProjectIds((current) => (current.includes(projectId) ? current : [...current, projectId]));
    setCollapsedHourTypeMap((current) => ({ ...current, [taskId]: true }));
  };

  const updateTaskName = (projectId: string, taskId: string, name: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.id !== projectId) {
            return project;
          }
          return {
            ...project,
            tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, name } : task)),
          };
        }),
      };
    });
  };

  const removeTask = (projectId: string, taskId: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.id !== projectId) {
            return project;
          }
          return {
            ...project,
            tasks: project.tasks.filter((task) => task.id !== taskId),
          };
        }),
      };
    });
    setCollapsedHourTypeMap((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const reorderTask = (projectId: string, taskIndex: number, direction: -1 | 1) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.id !== projectId) {
            return project;
          }
          return {
            ...project,
            tasks: moveItem(project.tasks, taskIndex, taskIndex + direction),
          };
        }),
      };
    });
  };

  const updateHourTypeName = (projectId: string, taskId: string, name: string) => {
    setConfig((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        projects: current.projects.map((project) => {
          if (project.id !== projectId) {
            return project;
          }
          return {
            ...project,
            tasks: project.tasks.map((task) => {
              if (task.id !== taskId) {
                return task;
              }
              const existingHourType = task.hourTypes[0];
              return {
                ...task,
                hourTypes: [
                  {
                    id: existingHourType?.id || crypto.randomUUID(),
                    name,
                  },
                ],
              };
            }),
          };
        }),
      };
    });
  };

  const toggleProject = (projectId: string) => {
    setOpenProjectIds((current) =>
      current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId],
    );
  };

  const toggleHourTypeEditor = (taskId: string) => {
    setCollapsedHourTypeMap((current) => ({ ...current, [taskId]: !(current[taskId] ?? true) }));
  };

  const save = async () => {
    if (!config) {
      return;
    }

    const normalizedForSave = normalizeConfigToSingleHourType(config);
    setConfig(normalizedForSave);
    setSaving(true);
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(normalizedForSave),
    });

    if (!response.ok) {
      pushToast("Could not save config. Try once more.", "error");
      setSaving(false);
      return;
    }

    const data = (await response.json()) as ConfigResponse;
    const normalized = normalizeConfigToSingleHourType(data.config);
    setConfig(normalized);
    setLastSavedSnapshot(configSnapshot(normalized));
    setSaving(false);
    pushToast("Configuration saved.", "success");
  };

  if (loading || !config) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading configuration...</p>;
  }

  return (
    <section className="space-y-4 pb-28">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Configuration</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Set up projects and tasks before week entry.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={addProject}>
              Add Project
            </Button>
            <Button onClick={save} disabled={saving || !hasUnsavedChanges}>
              {saving ? "Saving..." : "Save Config"}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Max Hours Per Day
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {WEEKDAY_LABELS.map((label, index) => (
                <label key={label} className="space-y-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    {label}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    value={config.maxHoursPerDay[index]}
                    className="h-9"
                    onChange={(event) => {
                      const next = [...config.maxHoursPerDay];
                      const parsed = Number(event.target.value);
                      next[index] = Number.isFinite(parsed) ? Math.max(0, Math.min(24, parsed)) : 0;
                      setConfig({
                        ...config,
                        maxHoursPerDay: next,
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Weekly max from daily caps: {formatHours(weeklyConfiguredMax)}h
            </p>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] p-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Workspace Summary
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-soft)]">
              {projectCount} project{projectCount === 1 ? "" : "s"} · {totalTaskCount} task
              {totalTaskCount === 1 ? "" : "s"} · 1 hour type per task
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Projects</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {filteredProjects.length} shown of {projectCount}
            </p>
          </div>
          <div className="w-full max-w-sm">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project or task"
            />
          </div>
        </div>

        {config.projects.length === 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-strong)] p-8 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">No projects yet. Add one to start configuring.</p>
            <Button className="mt-3" size="sm" onClick={addProject}>
              Add First Project
            </Button>
          </div>
        )}

        {filteredProjects.length === 0 && config.projects.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-8 text-center text-sm text-[var(--color-text-muted)]">
            Nothing matched this search.
          </div>
        )}

        <div className="mt-4 space-y-3">
          {filteredProjects.map((project, projectIndex) => {
            const isExpanded = openProjectIds.includes(project.id);
            const accentColor = PROJECT_ACCENT_COLORS[projectIndex % PROJECT_ACCENT_COLORS.length];

            return (
              <section
                key={project.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)]"
                style={{ borderLeftColor: accentColor, borderLeftWidth: "4px" }}
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => toggleProject(project.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
                      <h3 className="truncate text-base font-semibold">
                        {project.label?.trim() || project.name || "Untitled Project"}
                      </h3>
                    </div>
                    {project.label?.trim() && (
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        EBS name: {project.name || "Untitled Project"}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {project.tasks.length} task{project.tasks.length === 1 ? "" : "s"} · single hour type mode
                    </p>
                  </button>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => addTask(project.id)}>
                      Add Task
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleProject(project.id)}>
                      {isExpanded ? "Collapse" : "Expand"}
                    </Button>
                  </div>
                </header>

                {isExpanded && (
                  <div className="space-y-3 p-3">
                    <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
                      <Input
                        aria-label="Project label"
                        value={project.label ?? ""}
                        onChange={(event) => updateProjectLabel(project.id, event.target.value)}
                        placeholder="Display label (optional)"
                      />
                      <Input
                        aria-label="Project EBS name"
                        value={project.name}
                        onChange={(event) => updateProjectName(project.id, event.target.value)}
                        placeholder="EBS project name (required)"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reorderProject(projectIndex, -1)}
                        disabled={projectIndex === 0}
                        title="Move project up"
                      >
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reorderProject(projectIndex, 1)}
                        disabled={projectIndex === config.projects.length - 1}
                        title="Move project down"
                      >
                        Down
                      </Button>
                      <DeleteIconButton
                        label="Delete project"
                        size="sm"
                        confirm
                        confirmLabel="Confirm delete project"
                        onClick={() => removeProject(project.id)}
                      />
                    </div>

                    {project.tasks.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-strong)] p-6 text-center text-sm text-[var(--color-text-muted)]">
                        No tasks in this project yet.
                      </div>
                    )}

                    <div className="space-y-2">
                      {project.tasks.map((task, taskIndex) => {
                        const hourTypeCollapsed = collapsedHourTypeMap[task.id] ?? true;
                        const currentHourType = task.hourTypes[0] ?? {
                          id: DEFAULT_HOUR_TYPE_ID,
                          name: DEFAULT_HOUR_TYPE_NAME,
                        };
                        const isDefaultHourType =
                          currentHourType.name.trim().toLowerCase() ===
                          DEFAULT_HOUR_TYPE_NAME.toLowerCase();

                        return (
                          <article
                            key={task.id}
                            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                aria-label="Task name"
                                value={task.name}
                                onChange={(event) => updateTaskName(project.id, task.id, event.target.value)}
                                className="min-w-[12rem] flex-1"
                                placeholder="Task name"
                              />
                              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                                {isDefaultHourType ? "Default type" : "Custom type"}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => reorderTask(project.id, taskIndex, -1)}
                                disabled={taskIndex === 0}
                                title="Move task up"
                              >
                                Up
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => reorderTask(project.id, taskIndex, 1)}
                                disabled={taskIndex === project.tasks.length - 1}
                                title="Move task down"
                              >
                                Down
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleHourTypeEditor(task.id)}
                              >
                                {hourTypeCollapsed ? "Show Type" : "Hide Type"}
                              </Button>
                              <DeleteIconButton
                                label="Delete task"
                                size="sm"
                                confirm
                                confirmLabel="Confirm delete task"
                                onClick={() => removeTask(project.id, task.id)}
                              />
                            </div>

                            <div
                              className={cn(
                                "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200",
                                hourTypeCollapsed
                                  ? "grid-rows-[0fr] opacity-0"
                                  : "grid-rows-[1fr] opacity-100",
                              )}
                            >
                              <div className="min-h-0">
                                <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                                    Hour Type (single)
                                  </p>
                                  <Input
                                    aria-label="Hour type name"
                                    value={currentHourType.name}
                                    onChange={(event) =>
                                      updateHourTypeName(project.id, task.id, event.target.value)
                                    }
                                    className="mt-2 h-9"
                                    placeholder="Hour type name"
                                  />
                                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                    One hour type per task.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </Card>

      <div className="sticky bottom-3 z-30">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--floating-panel-bg)] p-3 shadow-lg backdrop-blur-md sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2.5 py-1">
                {projectCount} projects
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2.5 py-1">
                {totalTaskCount} tasks
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-strong)] px-2.5 py-1">
                1 type per task
              </span>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1",
                  hasUnsavedChanges ? "status-warn" : "status-ok",
                )}
              >
                {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
            <Button onClick={save} disabled={saving || !hasUnsavedChanges}>
              {saving ? "Saving..." : "Save Config"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
