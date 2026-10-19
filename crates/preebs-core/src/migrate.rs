use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::dateutil::{self, to_iso};
use crate::error::{Error, Result};
use crate::hours::Hours;
use crate::model::{
    HourType, Project, Task, UserConfig, WeekCustomProject, WeekDocument, WeekRowInput,
    DEFAULT_USER_ID,
};
use crate::normalize::{self, normalize_config, normalize_max_from_raw};
use crate::paths::LEGACY_DB_FILE_NAME;
use crate::store;
use crate::text::{now_iso, safe_trim};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrateReport {
    pub source: String,
    pub users: usize,
    pub projects: usize,
    pub tasks: usize,
    pub hour_types: usize,
    pub weeks: usize,
    pub rows: usize,
}

pub fn legacy_json_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(
            home.join("Library")
                .join("Application Support")
                .join("PreEBS")
                .join(LEGACY_DB_FILE_NAME),
        );
        paths.push(
            home.join("Library")
                .join("Application Support")
                .join("preebs")
                .join(LEGACY_DB_FILE_NAME),
        );
        paths.push(home.join(".preebs-desktop").join(LEGACY_DB_FILE_NAME));
    }
    if let Some(data) = dirs::data_dir() {
        let packaged = data.join("PreEBS").join(LEGACY_DB_FILE_NAME);
        if !paths.iter().any(|path| path == &packaged) {
            paths.push(packaged);
        }
    }
    paths.push(PathBuf::from("data").join(LEGACY_DB_FILE_NAME));
    paths
}

pub fn discover_legacy_db(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

#[derive(Debug, Deserialize)]
struct LegacyDb {
    #[serde(default)]
    configs: HashMap<String, Value>,
    #[serde(default)]
    weeks: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseConfig {
    #[serde(default)]
    max_hours_per_day: Vec<f64>,
    #[serde(default)]
    default_hour_type_name: Option<String>,
    #[serde(default)]
    projects: Vec<LooseProject>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseProject {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    tasks: Vec<LooseTask>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseTask {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    hour_types: Vec<LooseHourType>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseHourType {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseWeek {
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    week_start_date: String,
    #[serde(default)]
    custom_projects: Vec<WeekCustomProject>,
    #[serde(default)]
    rows: Vec<LooseRow>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LooseRow {
    #[serde(default)]
    id: String,
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    task_id: String,
    #[serde(default)]
    task_name: String,
    #[serde(default)]
    hour_type_id: String,
    #[serde(default)]
    hour_type_name: String,
    #[serde(default)]
    hours: Vec<f64>,
    #[serde(default)]
    note: Option<String>,
}

pub fn apply_legacy(
    conn: &rusqlite::Connection,
    source: &Path,
    value: &Value,
) -> Result<MigrateReport> {
    let legacy: LegacyDb = serde_json::from_value(value.clone())?;
    if legacy.configs.is_empty() {
        return Err(Error::validation("Legacy database has no config"));
    }
    let source_user = if legacy.configs.contains_key(DEFAULT_USER_ID) {
        DEFAULT_USER_ID.to_string()
    } else if legacy.configs.len() == 1 {
        legacy.configs.keys().next().expect("len checked").clone()
    } else {
        let mut keys: Vec<_> = legacy.configs.keys().cloned().collect();
        keys.sort();
        keys.remove(0)
    };
    let only_one_user = legacy.configs.len() == 1;
    let raw_config = legacy
        .configs
        .get(&source_user)
        .expect("source user chosen from the map");
    let config = config_from_loose(raw_config)?;
    crate::resolve::validate_config_ids(&config)?;
    store::put_config(conn, &config)?;

    let mut weeks = 0;
    let mut rows = 0;
    let mut keys: Vec<_> = legacy.weeks.keys().cloned().collect();
    keys.sort();
    for key in keys {
        let Some(week) = week_from_legacy(
            &key,
            &legacy.weeks[&key],
            &config,
            &source_user,
            only_one_user,
        )?
        else {
            continue;
        };
        rows += week.rows.len();
        weeks += 1;
        store::put_week(conn, &week)?;
    }

    let tasks = config
        .projects
        .iter()
        .map(|project| project.tasks.len())
        .sum();
    let hour_types = config
        .projects
        .iter()
        .flat_map(|project| project.tasks.iter())
        .map(|task| task.hour_types.len())
        .sum();
    Ok(MigrateReport {
        source: source.display().to_string(),
        users: 1,
        projects: config.projects.len(),
        tasks,
        hour_types,
        weeks,
        rows,
    })
}

fn config_from_loose(value: &Value) -> Result<UserConfig> {
    let loose: LooseConfig = serde_json::from_value(value.clone())?;
    let projects = loose
        .projects
        .into_iter()
        .map(|project| Project {
            id: project.id,
            name: project.name,
            label: project.label,
            archived: project.archived,
            tasks: project
                .tasks
                .into_iter()
                .map(|task| Task {
                    id: task.id,
                    name: task.name,
                    label: task.label,
                    hour_types: task
                        .hour_types
                        .into_iter()
                        .map(|hour_type| HourType {
                            id: hour_type.id,
                            name: hour_type.name,
                        })
                        .collect(),
                })
                .collect(),
        })
        .collect();
    Ok(normalize_config(UserConfig {
        user_id: DEFAULT_USER_ID.to_string(),
        max_hours_per_day: normalize_max_from_raw(&loose.max_hours_per_day),
        default_hour_type_name: loose
            .default_hour_type_name
            .filter(|name| !safe_trim(name).is_empty())
            .unwrap_or_else(crate::model::default_hour_type_name),
        projects,
        updated_at: now_iso(),
    }))
}

fn week_from_legacy(
    key: &str,
    value: &Value,
    config: &UserConfig,
    source_user: &str,
    only_one_user: bool,
) -> Result<Option<WeekDocument>> {
    if !value.is_object() {
        return Err(Error::validation(format!(
            "Legacy week {key} is not an object"
        )));
    }
    let loose: LooseWeek = serde_json::from_value(value.clone())?;
    let user_id = safe_trim(&loose.user_id);
    if !user_id.is_empty() && user_id != source_user && !only_one_user {
        return Ok(None);
    }
    let start_raw = if loose.week_start_date.trim().is_empty() {
        key.split_once(':')
            .map(|(_, date)| date)
            .unwrap_or(key)
            .to_string()
    } else {
        loose.week_start_date
    };
    let start = dateutil::require_week_start(&start_raw).map_err(|_| {
        Error::validation(format!("Legacy week {key} has an invalid weekStartDate"))
    })?;
    let inputs = loose
        .rows
        .iter()
        .map(|row| {
            let mut hours = [Hours::ZERO; 5];
            for (index, value) in row.hours.iter().take(5).enumerate() {
                hours[index] = Hours::clamp_f64(*value);
            }
            WeekRowInput {
                id: row.id.clone(),
                project_id: row.project_id.clone(),
                project_name: row.project_name.clone(),
                task_id: row.task_id.clone(),
                task_name: row.task_name.clone(),
                hour_type_id: row.hour_type_id.clone(),
                hour_type_name: row.hour_type_name.clone(),
                hours,
                note: row.note.clone(),
            }
        })
        .collect::<Vec<_>>();
    let custom_names = loose
        .custom_projects
        .iter()
        .map(|project| (safe_trim(&project.id), safe_trim(&project.name)))
        .filter(|(id, _)| !id.is_empty())
        .collect();
    let rows = normalize::normalize_week_rows(&inputs, config, &custom_names);
    let custom_projects =
        normalize::normalize_custom_projects(&loose.custom_projects, &rows, config);
    let now = now_iso();
    let created_at = if loose.created_at.trim().is_empty() {
        now.clone()
    } else {
        loose.created_at
    };
    let updated_at = if loose.updated_at.trim().is_empty() {
        now
    } else {
        loose.updated_at
    };
    Ok(Some(WeekDocument {
        id: format!("{DEFAULT_USER_ID}:{}", to_iso(start)),
        user_id: DEFAULT_USER_ID.to_string(),
        week_start_date: to_iso(start),
        week_end_date: to_iso(dateutil::week_end(start)),
        custom_projects,
        rows,
        created_at,
        updated_at,
    }))
}
