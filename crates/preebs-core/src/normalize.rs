use std::collections::{HashMap, HashSet};

use crate::hours::Hours;
use crate::model::{
    default_hour_type_name, default_max_hours, HourType, Project, StoredWeekRow, Task, UserConfig,
    WeekCustomProject, WeekRowInput, DEFAULT_HOUR_TYPE_ID, DEFAULT_HOUR_TYPE_NAME, DEFAULT_USER_ID,
};
use crate::text::{names_equal, new_id, now_iso, safe_trim};

pub fn default_hour_type(name: &str) -> HourType {
    let trimmed = safe_trim(name);
    let name = if trimmed.is_empty() {
        default_hour_type_name()
    } else {
        trimmed
    };
    let id = if names_equal(&name, DEFAULT_HOUR_TYPE_NAME) {
        DEFAULT_HOUR_TYPE_ID.to_string()
    } else {
        new_id()
    };
    HourType { id, name }
}

/// One hour type per task, matching `normalizeSingleHourType` in the old store.
///
/// Empty names are already dropped by the caller. An empty list becomes the
/// configured default. Otherwise the first hour type whose name is not
/// `Straight Time` (case-insensitive) wins; if every name is that default,
/// the first hour type is kept. The surviving id and name are unchanged.
pub fn collapse_hour_types(hour_types: Vec<HourType>, default_name: &str) -> Vec<HourType> {
    if hour_types.is_empty() {
        return vec![default_hour_type(default_name)];
    }
    let index = hour_types
        .iter()
        .position(|hour_type| !names_equal(&hour_type.name, DEFAULT_HOUR_TYPE_NAME))
        .unwrap_or(0);
    vec![hour_types
        .into_iter()
        .nth(index)
        .expect("index is in range")]
}

/// Pad and snap `maxHoursPerDay`, and collapse each task to one hour type.
pub fn normalize_config(config: UserConfig) -> UserConfig {
    let max_hours_per_day = std::array::from_fn(|index| {
        config
            .max_hours_per_day
            .get(index)
            .copied()
            .unwrap_or(Hours::EIGHT)
    });
    let default_name = {
        let trimmed = safe_trim(&config.default_hour_type_name);
        if trimmed.is_empty() {
            default_hour_type_name()
        } else {
            trimmed
        }
    };
    let projects = config
        .projects
        .into_iter()
        .filter_map(|project| normalize_project(project, &default_name))
        .collect();
    UserConfig {
        user_id: {
            let id = safe_trim(&config.user_id);
            if id.is_empty() {
                DEFAULT_USER_ID.to_string()
            } else {
                id
            }
        },
        max_hours_per_day,
        default_hour_type_name: default_name,
        projects,
        updated_at: now_iso(),
    }
}

fn normalize_project(project: Project, default_name: &str) -> Option<Project> {
    let name = safe_trim(&project.name);
    if name.is_empty() {
        return None;
    }
    let label = {
        let label = project.label.unwrap_or_default();
        let label = safe_trim(&label);
        if label.is_empty() {
            None
        } else {
            Some(label)
        }
    };
    let tasks = project
        .tasks
        .into_iter()
        .filter_map(|task| normalize_task(task, default_name))
        .collect();
    let id = safe_trim(&project.id);
    Some(Project {
        id: if id.is_empty() { new_id() } else { id },
        name,
        label,
        archived: project.archived,
        tasks,
    })
}

fn normalize_task(task: Task, default_name: &str) -> Option<Task> {
    let name = safe_trim(&task.name);
    if name.is_empty() {
        return None;
    }
    let hour_types: Vec<HourType> = task
        .hour_types
        .into_iter()
        .filter_map(|hour_type| {
            let name = safe_trim(&hour_type.name);
            if name.is_empty() {
                return None;
            }
            let id = safe_trim(&hour_type.id);
            Some(HourType {
                id: if id.is_empty() { new_id() } else { id },
                name,
            })
        })
        .collect();
    let hour_types = collapse_hour_types(hour_types, default_name);
    let label = task
        .label
        .as_deref()
        .map(safe_trim)
        .filter(|label| !label.is_empty());
    let id = safe_trim(&task.id);
    Some(Task {
        id: if id.is_empty() { new_id() } else { id },
        name,
        label,
        hour_types,
    })
}

pub fn normalize_max_from_raw(values: &[f64]) -> [Hours; 5] {
    let mut hours = default_max_hours();
    for (index, value) in values.iter().take(5).enumerate() {
        if value.is_finite() {
            hours[index] = Hours::clamp_f64(*value);
        }
    }
    hours
}

struct NameMaps<'a> {
    projects: HashMap<&'a str, &'a Project>,
    tasks: HashMap<&'a str, &'a Task>,
    tasks_by_project: HashMap<&'a str, HashSet<&'a str>>,
}

fn name_maps(config: &UserConfig) -> NameMaps<'_> {
    let mut maps = NameMaps {
        projects: HashMap::new(),
        tasks: HashMap::new(),
        tasks_by_project: HashMap::new(),
    };
    for project in &config.projects {
        maps.projects.insert(project.id.as_str(), project);
        maps.tasks_by_project.insert(
            project.id.as_str(),
            project.tasks.iter().map(|task| task.id.as_str()).collect(),
        );
        for task in &project.tasks {
            maps.tasks.insert(task.id.as_str(), task);
        }
    }
    maps
}

pub fn normalize_week_rows(
    rows: &[WeekRowInput],
    config: &UserConfig,
    custom_names: &HashMap<String, String>,
) -> Vec<StoredWeekRow> {
    let maps = name_maps(config);
    let mut normalized = Vec::new();
    for row in rows {
        let project_id = safe_trim(&row.project_id);
        let task_id = safe_trim(&row.task_id);
        let hour_type_id = safe_trim(&row.hour_type_id);
        if project_id.is_empty() || task_id.is_empty() || hour_type_id.is_empty() {
            continue;
        }
        let project_ref = maps.projects.get(project_id.as_str()).copied();
        let task_ref = maps.tasks.get(task_id.as_str()).copied();
        let on_project = project_ref.is_some()
            && task_ref.is_some()
            && maps
                .tasks_by_project
                .get(project_id.as_str())
                .is_some_and(|ids| ids.contains(task_id.as_str()));
        // A configured task has one hour type. Rows that still name an older
        // hour type are rewritten onto it and merged below.
        let (project_name, task_name, hour_type_id, hour_type_name) = if on_project {
            let project = project_ref.expect("on_project");
            let task = task_ref.expect("on_project");
            let Some(hour_type) = task.hour_types.first() else {
                continue;
            };
            (
                project.name.clone(),
                task.name.clone(),
                hour_type.id.clone(),
                hour_type.name.clone(),
            )
        } else {
            let project_name = {
                let from_row = safe_trim(&row.project_name);
                if !from_row.is_empty() {
                    from_row
                } else {
                    custom_names
                        .get(&project_id)
                        .cloned()
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| "Custom Project".to_string())
                }
            };
            let task_name = safe_trim(&row.task_name);
            let hour_type_name = {
                let from_row = safe_trim(&row.hour_type_name);
                if from_row.is_empty() {
                    DEFAULT_HOUR_TYPE_NAME.to_string()
                } else {
                    from_row
                }
            };
            (project_name, task_name, hour_type_id, hour_type_name)
        };
        if project_name.is_empty() || hour_type_name.is_empty() {
            continue;
        }
        let note = row
            .note
            .as_deref()
            .map(safe_trim)
            .filter(|note| !note.is_empty());
        let id = safe_trim(&row.id);
        normalized.push(StoredWeekRow {
            id: if id.is_empty() { new_id() } else { id },
            project_id,
            project_name,
            task_id,
            task_name,
            hour_type_id,
            hour_type_name,
            hours: row.hours,
            note,
        });
    }

    let mut order = Vec::new();
    let mut by_combo: HashMap<String, StoredWeekRow> = HashMap::new();
    for row in normalized {
        let key = format!("{}:{}:{}", row.project_id, row.task_id, row.hour_type_id);
        if let Some(existing) = by_combo.get_mut(&key) {
            for (index, value) in row.hours.iter().enumerate() {
                existing.hours[index] = existing.hours[index].saturating_add(*value);
            }
            if existing.note.is_none() {
                existing.note.clone_from(&row.note);
            }
        } else {
            order.push(key.clone());
            by_combo.insert(key, row);
        }
    }
    order
        .into_iter()
        .filter_map(|key| by_combo.remove(&key))
        .collect()
}

pub fn normalize_custom_projects(
    custom_projects: &[WeekCustomProject],
    rows: &[StoredWeekRow],
    config: &UserConfig,
) -> Vec<WeekCustomProject> {
    let configured: HashSet<&str> = config
        .projects
        .iter()
        .map(|project| project.id.as_str())
        .collect();
    let mut order = Vec::new();
    let mut by_id: HashMap<String, WeekCustomProject> = HashMap::new();
    for project in custom_projects {
        let id = safe_trim(&project.id);
        if id.is_empty() || configured.contains(id.as_str()) || by_id.contains_key(&id) {
            continue;
        }
        let name = safe_trim(&project.name);
        let name = if name.is_empty() {
            "Custom Project".to_string()
        } else {
            name
        };
        order.push(id.clone());
        by_id.insert(id.clone(), WeekCustomProject { id, name });
    }
    for row in rows {
        if configured.contains(row.project_id.as_str()) || by_id.contains_key(&row.project_id) {
            continue;
        }
        let id = safe_trim(&row.project_id);
        let name = safe_trim(&row.project_name);
        if id.is_empty() || name.is_empty() {
            continue;
        }
        order.push(id.clone());
        by_id.insert(id.clone(), WeekCustomProject { id, name });
    }
    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}
