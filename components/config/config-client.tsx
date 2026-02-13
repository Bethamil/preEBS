"use client";

import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_HOUR_TYPE_ID, DEFAULT_HOUR_TYPE_NAME } from "@/lib/constants";
import type { Project, UserConfig } from "@/lib/types";

interface ConfigResponse {
  config: UserConfig;
}

function createBlankProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: "New Project",
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

export function ConfigClient() {
  const { pushToast } = useToast();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const response = await fetch("/api/config", { cache: "no-store" });
      const data = (await response.json()) as ConfigResponse;
      setConfig(data.config);
      setLoading(false);
    };
    run();
  }, []);

  const projectCount = useMemo(() => config?.projects.length ?? 0, [config]);

  const addProject = () => {
    if (!config) {
      return;
    }
    setConfig({
      ...config,
      projects: [...config.projects, createBlankProject()],
    });
  };

  const updateProjectName = (projectId: string, name: string) => {
    if (!config) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) =>
        project.id === projectId ? { ...project, name } : project,
      ),
    });
  };

  const removeProject = (projectId: string) => {
    if (!config) {
      return;
    }
    const confirmed = window.confirm("Delete this project and all nested tasks/hour types?");
    if (!confirmed) {
      return;
    }
    setConfig({
      ...config,
      projects: config.projects.filter((project) => project.id !== projectId),
    });
  };

  const reorderProject = (projectIndex: number, direction: -1 | 1) => {
    if (!config) {
      return;
    }
    setConfig({
      ...config,
      projects: moveItem(config.projects, projectIndex, projectIndex + direction),
    });
  };

  const addTask = (projectId: string) => {
    if (!config) {
      return;
    }
    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }

        return {
          ...project,
          tasks: [
            ...project.tasks,
            {
              id: crypto.randomUUID(),
              name: "New Task",
              hourTypes: [{ id: DEFAULT_HOUR_TYPE_ID, name: DEFAULT_HOUR_TYPE_NAME }],
            },
          ],
        };
      }),
    });
  };

  const updateTaskName = (projectId: string, taskId: string, name: string) => {
    if (!config) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, name } : task)),
        };
      }),
    });
  };

  const removeTask = (projectId: string, taskId: string) => {
    if (!config) {
      return;
    }
    const confirmed = window.confirm("Delete this task and all hour types?");
    if (!confirmed) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.filter((task) => task.id !== taskId),
        };
      }),
    });
  };

  const reorderTask = (projectId: string, taskIndex: number, direction: -1 | 1) => {
    if (!config) {
      return;
    }
    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: moveItem(project.tasks, taskIndex, taskIndex + direction),
        };
      }),
    });
  };

  const addHourType = (projectId: string, taskId: string) => {
    if (!config) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => {
            if (task.id !== taskId) {
              return task;
            }
            return {
              ...task,
              hourTypes: [...task.hourTypes, { id: crypto.randomUUID(), name: "New Hour Type" }],
            };
          }),
        };
      }),
    });
  };

  const updateHourTypeName = (
    projectId: string,
    taskId: string,
    hourTypeId: string,
    name: string,
  ) => {
    if (!config) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => {
            if (task.id !== taskId) {
              return task;
            }
            return {
              ...task,
              hourTypes: task.hourTypes.map((hourType) =>
                hourType.id === hourTypeId ? { ...hourType, name } : hourType,
              ),
            };
          }),
        };
      }),
    });
  };

  const removeHourType = (projectId: string, taskId: string, hourTypeId: string) => {
    if (!config) {
      return;
    }

    setConfig({
      ...config,
      projects: config.projects.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => {
            if (task.id !== taskId) {
              return task;
            }
            return {
              ...task,
              hourTypes: task.hourTypes.filter((hourType) => hourType.id !== hourTypeId),
            };
          }),
        };
      }),
    });
  };

  const save = async () => {
    if (!config) {
      return;
    }

    setSaving(true);
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      pushToast("Could not save config. Try once more.", "error");
      setSaving(false);
      return;
    }

    const data = (await response.json()) as ConfigResponse;
    setConfig(data.config);
    setSaving(false);
    pushToast("Configuration saved.", "success");
  };

  if (loading || !config) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading configuration…</p>;
  }

  return (
    <section className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Configuration</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Manage projects, tasks, and hour types before you enter your week.
            </p>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Config"}
          </Button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Max Hours per Week</span>
            <Input
              type="number"
              min={1}
              max={168}
              value={config.maxHoursPerWeek}
              onChange={(event) =>
                setConfig({
                  ...config,
                  maxHoursPerWeek: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={config.blockOnMaxHoursExceed}
              onChange={(event) =>
                setConfig({
                  ...config,
                  blockOnMaxHoursExceed: event.target.checked,
                })
              }
            />
            Block save when week exceeds max hours
          </label>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Projects</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {projectCount} project{projectCount === 1 ? "" : "s"} configured.
            </p>
          </div>
          <Button variant="secondary" onClick={addProject}>
            Add Project
          </Button>
        </div>

        <div className="space-y-4">
          {config.projects.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-strong)] p-6 text-sm text-[var(--color-text-muted)]">
              No projects yet. Add one to unlock week entry.
            </div>
          )}

          {config.projects.map((project, projectIndex) => (
            <section key={project.id} className="rounded-2xl border border-[var(--color-border)] bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Project name"
                  value={project.name}
                  onChange={(event) => updateProjectName(project.id, event.target.value)}
                  className="max-w-sm"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reorderProject(projectIndex, -1)}
                  disabled={projectIndex === 0}
                >
                  Move Up
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reorderProject(projectIndex, 1)}
                  disabled={projectIndex === config.projects.length - 1}
                >
                  Move Down
                </Button>
                <Button variant="destructive" size="sm" onClick={() => removeProject(project.id)}>
                  Delete Project
                </Button>
                <Button variant="secondary" size="sm" onClick={() => addTask(project.id)}>
                  Add Task
                </Button>
              </div>

              <div className="mt-3 space-y-3">
                {project.tasks.map((task, taskIndex) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-strong)] p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Task name"
                        value={task.name}
                        onChange={(event) =>
                          updateTaskName(project.id, task.id, event.target.value)
                        }
                        className="max-w-sm"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reorderTask(project.id, taskIndex, -1)}
                        disabled={taskIndex === 0}
                      >
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reorderTask(project.id, taskIndex, 1)}
                        disabled={taskIndex === project.tasks.length - 1}
                      >
                        Down
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeTask(project.id, task.id)}
                      >
                        Delete Task
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => addHourType(project.id, task.id)}
                      >
                        Add Hour Type
                      </Button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {task.hourTypes.map((hourType) => {
                        const isDefault = hourType.name === DEFAULT_HOUR_TYPE_NAME;
                        return (
                          <div key={hourType.id} className="flex gap-2">
                            <Input
                              aria-label="Hour type name"
                              value={hourType.name}
                              onChange={(event) =>
                                updateHourTypeName(
                                  project.id,
                                  task.id,
                                  hourType.id,
                                  event.target.value,
                                )
                              }
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => removeHourType(project.id, task.id, hourType.id)}
                              disabled={isDefault}
                              title={isDefault ? "Default hour type is always available" : "Delete hour type"}
                            >
                              ✕
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Card>
    </section>
  );
}
