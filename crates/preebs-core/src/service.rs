use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::config_transfer::{self, ParsedConfig};
use crate::dateutil::{self, to_iso};
use crate::error::{Error, Result};
use crate::export::{self, WeekExportDocument};
use crate::hours::{HourSum, Hours};
use crate::migrate::{self, MigrateReport};
use crate::model::*;
use crate::normalize::{self, normalize_config};
use crate::paths::{self, resolve_db_path};
use crate::resolve::{self, hour_type_for_booking};
use crate::store;
use crate::text::{names_equal, new_id, now_iso, safe_trim};

/// `Keep` leaves the field unchanged. `Set("")` clears optional text such as a label.
#[derive(Debug, Clone, Copy)]
pub enum FieldUpdate<'a> {
    Keep,
    Set(&'a str),
}

/// Open database. The CLI and the desktop app both use this type.
pub struct PreEbs {
    conn: Connection,
    path: PathBuf,
}

impl PreEbs {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        store::initialize(&conn)?;
        Ok(Self {
            conn,
            path: path.to_path_buf(),
        })
    }

    pub fn open_default() -> Result<Self> {
        Self::open(&resolve_db_path(None, None))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn revision(&self) -> Result<u64> {
        store::revision(&self.conn)
    }

    pub fn config(&self) -> Result<UserConfig> {
        store::load_config(&self.conn)
    }

    pub fn save_config(&mut self, config: UserConfig, dry_run: bool) -> Result<UserConfig> {
        let config = normalize_config(config);
        resolve::validate_config_ids(&config)?;
        self.write(dry_run, |conn| {
            store::put_config(conn, &config)?;
            Ok(config.clone())
        })
    }

    pub fn set_settings(
        &mut self,
        max_hours: Option<[Hours; 5]>,
        default_hour_type_name: Option<&str>,
        dry_run: bool,
    ) -> Result<UserConfig> {
        if max_hours.is_none() && default_hour_type_name.is_none() {
            return Err(Error::validation(
                "Pass --max-hours and/or --default-hour-type",
            ));
        }
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            if let Some(max_hours) = max_hours {
                config.max_hours_per_day = max_hours;
            }
            if let Some(name) = default_hour_type_name {
                let name = safe_trim(name);
                if name.is_empty() {
                    return Err(Error::validation("Default hour type name is required"));
                }
                config.default_hour_type_name = name;
            }
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(config)
        })
    }

    pub fn add_project(
        &mut self,
        name: &str,
        label: Option<&str>,
        id: Option<&str>,
        dry_run: bool,
    ) -> Result<Project> {
        let name = resolve::require_name(name, "Project name")?;
        let label = label.map(safe_trim).filter(|value| !value.is_empty());
        let id = match id {
            Some(id) => resolve::clean_id(id)?,
            None => new_id(),
        };
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            resolve::ensure_unique_project_id(&config, &id)?;
            let project = Project {
                id,
                name,
                label,
                tasks: Vec::new(),
            };
            config.projects.push(project.clone());
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(project)
        })
    }

    pub fn edit_project(
        &mut self,
        token: &str,
        name: FieldUpdate<'_>,
        label: FieldUpdate<'_>,
        dry_run: bool,
    ) -> Result<Project> {
        if matches!(name, FieldUpdate::Keep) && matches!(label, FieldUpdate::Keep) {
            return Err(Error::validation(
                "Nothing to update. Pass --name and/or --label.",
            ));
        }
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let index = resolve::project_index(&config, token)?;
            if let FieldUpdate::Set(name) = name {
                config.projects[index].name = resolve::require_name(name, "Project name")?;
            }
            if let FieldUpdate::Set(label) = label {
                let label = safe_trim(label);
                config.projects[index].label = if label.is_empty() { None } else { Some(label) };
            }
            config.updated_at = now_iso();
            let project = config.projects[index].clone();
            store::put_config(conn, &config)?;
            Ok(project)
        })
    }

    pub fn remove_project(&mut self, token: &str, dry_run: bool) -> Result<Project> {
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let index = resolve::project_index(&config, token)?;
            let project = config.projects.remove(index);
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(project)
        })
    }

    pub fn add_task(
        &mut self,
        project: &str,
        name: &str,
        hour_type_names: &[String],
        id: Option<&str>,
        dry_run: bool,
    ) -> Result<Task> {
        let name = resolve::require_name(name, "Task name")?;
        let id = match id {
            Some(id) => resolve::clean_id(id)?,
            None => new_id(),
        };
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            resolve::ensure_unique_task_id(&config, &id)?;
            let project_index = resolve::project_index(&config, project)?;
            let hour_types = hour_types_from_names(hour_type_names, &config.default_hour_type_name);
            let task = Task {
                id,
                name,
                hour_types,
            };
            config.projects[project_index].tasks.push(task.clone());
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(task)
        })
    }

    pub fn edit_task(&mut self, token: &str, name: Option<&str>, dry_run: bool) -> Result<Task> {
        let Some(name) = name else {
            return Err(Error::validation("Nothing to update. Pass --name."));
        };
        let name = resolve::require_name(name, "Task name")?;
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let (project_index, task_index) = resolve::task_location(&config, token)?;
            config.projects[project_index].tasks[task_index].name = name;
            config.updated_at = now_iso();
            let task = config.projects[project_index].tasks[task_index].clone();
            store::put_config(conn, &config)?;
            Ok(task)
        })
    }

    pub fn remove_task(&mut self, token: &str, dry_run: bool) -> Result<Task> {
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let (project_index, task_index) = resolve::task_location(&config, token)?;
            let task = config.projects[project_index].tasks.remove(task_index);
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(task)
        })
    }

    pub fn add_hour_type(
        &mut self,
        project: &str,
        task: &str,
        name: &str,
        id: Option<&str>,
        dry_run: bool,
    ) -> Result<HourType> {
        let name = resolve::require_name(name, "Hour type name")?;
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let project_index = resolve::project_index(&config, project)?;
            let task_index = resolve::task_index(&config.projects[project_index], task)?;
            let mut hour_type = if let Some(id) = id {
                HourType {
                    id: resolve::clean_id(id)?,
                    name,
                }
            } else {
                normalize::default_hour_type(&name)
            };
            let existing = &config.projects[project_index].tasks[task_index].hour_types;
            if existing.iter().any(|item| item.id == hour_type.id) {
                if id.is_some() {
                    return Err(Error::conflict(format!(
                        "Hour type id already exists on this task: {}",
                        hour_type.id
                    )));
                }
                hour_type.id = new_id();
            }
            config.projects[project_index].tasks[task_index]
                .hour_types
                .push(hour_type.clone());
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(hour_type)
        })
    }

    pub fn edit_hour_type(
        &mut self,
        token: &str,
        name: Option<&str>,
        project: Option<&str>,
        task: Option<&str>,
        dry_run: bool,
    ) -> Result<HourType> {
        let Some(name) = name else {
            return Err(Error::validation("Nothing to update. Pass --name."));
        };
        let name = resolve::require_name(name, "Hour type name")?;
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let (project_index, task_index, hour_index) =
                resolve::hour_type_location(&config, token, project, task)?;
            config.projects[project_index].tasks[task_index].hour_types[hour_index].name = name;
            config.updated_at = now_iso();
            let hour_type =
                config.projects[project_index].tasks[task_index].hour_types[hour_index].clone();
            store::put_config(conn, &config)?;
            Ok(hour_type)
        })
    }

    pub fn remove_hour_type(
        &mut self,
        token: &str,
        project: Option<&str>,
        task: Option<&str>,
        dry_run: bool,
    ) -> Result<HourType> {
        self.write(dry_run, |conn| {
            let mut config = store::load_config(conn)?;
            let (project_index, task_index, hour_index) =
                resolve::hour_type_location(&config, token, project, task)?;
            let hour_types = &mut config.projects[project_index].tasks[task_index].hour_types;
            if hour_types.len() <= 1 {
                return Err(Error::validation("A task must keep at least one hour type"));
            }
            let hour_type = hour_types.remove(hour_index);
            config.updated_at = now_iso();
            store::put_config(conn, &config)?;
            Ok(hour_type)
        })
    }

    pub fn list_weeks(&self, query: &str) -> Result<Vec<WeekSummary>> {
        let config = self.config()?;
        let required = HourSum::saturating_from_hours_slice(&config.max_hours_per_day);
        let mut summaries = Vec::new();
        for week in store::list_weeks(&self.conn)? {
            if !week_matches(&week, query) {
                continue;
            }
            let total = HourSum::from_halves(week.total_halves());
            let delta = HourSum::from_halves(total.halves() - required.halves());
            let hours_status = match delta.halves().cmp(&0) {
                std::cmp::Ordering::Equal => HoursStatus::Match,
                std::cmp::Ordering::Less => HoursStatus::Under,
                std::cmp::Ordering::Greater => HoursStatus::Over,
            };
            summaries.push(WeekSummary {
                week_start_date: week.week_start_date,
                week_end_date: week.week_end_date,
                total_hours: total,
                required_hours: required,
                hours_delta: delta,
                hours_status,
                updated_at: week.updated_at,
            });
        }
        Ok(summaries)
    }

    pub fn week_view(&self, date: &str) -> Result<WeekView> {
        let start = dateutil::require_week_start(date)?;
        let config = self.config()?;
        let existing = store::load_week(&self.conn, &to_iso(start))?;
        let exists = existing.is_some();
        Ok(WeekView {
            week: existing.unwrap_or_else(|| WeekDocument::empty(start)),
            recent_combos: recent_combos_from(&store::list_weeks(&self.conn)?, 8),
            config,
            exists,
        })
    }

    pub fn save_week(
        &mut self,
        date: &str,
        rows: &[WeekRowInput],
        custom_projects: &[WeekCustomProject],
        dry_run: bool,
    ) -> Result<WeekDocument> {
        let start = dateutil::require_week_start(date)?;
        self.write(dry_run, |conn| {
            let config = store::load_config(conn)?;
            let existing = store::load_week(conn, &to_iso(start))?;
            let custom_names = custom_name_map(custom_projects);
            let normalized_rows = normalize::normalize_week_rows(rows, &config, &custom_names);
            let normalized_custom =
                normalize::normalize_custom_projects(custom_projects, &normalized_rows, &config);
            let now = now_iso();
            let week = WeekDocument {
                id: format!("{DEFAULT_USER_ID}:{}", to_iso(start)),
                user_id: DEFAULT_USER_ID.to_string(),
                week_start_date: to_iso(start),
                week_end_date: to_iso(dateutil::week_end(start)),
                custom_projects: normalized_custom,
                rows: normalized_rows,
                created_at: existing
                    .as_ref()
                    .map(|week| week.created_at.clone())
                    .unwrap_or_else(|| now.clone()),
                updated_at: now,
            };
            store::put_week(conn, &week)?;
            Ok(week)
        })
    }

    pub fn delete_week(&mut self, date: &str, dry_run: bool) -> Result<()> {
        let start = dateutil::require_week_start(date)?;
        self.write(dry_run, |conn| {
            if !store::delete_week(conn, &to_iso(start))? {
                return Err(Error::not_found("Week not found"));
            }
            Ok(())
        })
    }

    pub fn copy_previous_week(&mut self, date: &str, dry_run: bool) -> Result<WeekDocument> {
        let start = dateutil::require_week_start(date)?;
        self.write(dry_run, |conn| {
            let previous = dateutil::shift_week(start, -1);
            let Some(source) = store::load_week(conn, &to_iso(previous))? else {
                return Err(Error::not_found("No previous week found to copy."));
            };
            let existing = store::load_week(conn, &to_iso(start))?;
            let now = now_iso();
            let week = WeekDocument {
                id: format!("{DEFAULT_USER_ID}:{}", to_iso(start)),
                user_id: DEFAULT_USER_ID.to_string(),
                week_start_date: to_iso(start),
                week_end_date: to_iso(dateutil::week_end(start)),
                custom_projects: source.custom_projects,
                rows: source
                    .rows
                    .into_iter()
                    .map(|mut row| {
                        row.id = new_id();
                        row
                    })
                    .collect(),
                created_at: existing
                    .map(|week| week.created_at)
                    .unwrap_or_else(|| now.clone()),
                updated_at: now,
            };
            store::put_week(conn, &week)?;
            Ok(week)
        })
    }

    pub fn add_custom_project(
        &mut self,
        date: &str,
        name: &str,
        id: Option<&str>,
        dry_run: bool,
    ) -> Result<WeekDocument> {
        let start = dateutil::require_week_start(date)?;
        let name = resolve::require_name(name, "Custom project name")?;
        let id = match id {
            Some(id) => resolve::clean_id(id)?,
            None => format!("custom-project:{}", new_id()),
        };
        self.write(dry_run, |conn| {
            let config = store::load_config(conn)?;
            if config.projects.iter().any(|project| project.id == id) {
                return Err(Error::validation(
                    "Custom project id matches a configured project",
                ));
            }
            let mut week = store::load_week(conn, &to_iso(start))?
                .unwrap_or_else(|| WeekDocument::empty(start));
            if week.custom_projects.iter().any(|project| project.id == id) {
                return Err(Error::conflict(format!(
                    "Custom project already exists: {id}"
                )));
            }
            week.custom_projects.push(WeekCustomProject {
                id: id.clone(),
                name: name.clone(),
            });
            week.updated_at = now_iso();
            store::put_week(conn, &week)?;
            Ok(week)
        })
    }

    pub fn remove_custom_project(
        &mut self,
        date: &str,
        token: &str,
        dry_run: bool,
    ) -> Result<WeekDocument> {
        let start = dateutil::require_week_start(date)?;
        let token = token.trim();
        if token.is_empty() {
            return Err(Error::validation("A custom project id or name is required"));
        }
        self.write(dry_run, |conn| {
            let Some(mut week) = store::load_week(conn, &to_iso(start))? else {
                return Err(Error::not_found("Week not found"));
            };
            let id_hits: Vec<usize> = week
                .custom_projects
                .iter()
                .enumerate()
                .filter(|(_, project)| project.id == token)
                .map(|(index, _)| index)
                .collect();
            let index = if id_hits.len() == 1 {
                id_hits[0]
            } else {
                let name_hits: Vec<usize> = week
                    .custom_projects
                    .iter()
                    .enumerate()
                    .filter(|(_, project)| names_equal(&project.name, token))
                    .map(|(index, _)| index)
                    .collect();
                match name_hits.as_slice() {
                    [index] => *index,
                    [] => return Err(Error::not_found(format!("Unknown custom project: {token}"))),
                    _ => {
                        return Err(Error::ambiguous(format!(
                            "Ambiguous custom project name \"{token}\". Pass its id."
                        )))
                    }
                }
            };
            let removed = week.custom_projects.remove(index);
            week.rows.retain(|row| row.project_id != removed.id);
            week.updated_at = now_iso();
            store::put_week(conn, &week)?;
            Ok(week)
        })
    }

    pub fn book(&mut self, input: BookInput<'_>, dry_run: bool) -> Result<BookingResult> {
        self.write(dry_run, |conn| book_with(conn, &input))
    }

    pub fn export_week(&self, date: &str) -> Result<WeekExportDocument> {
        let start = dateutil::require_week_start(date)?;
        let config = self.config()?;
        let week = store::load_week(&self.conn, &to_iso(start))?
            .ok_or_else(|| Error::not_found("Week not found"))?;
        Ok(export::build_week_export(&config, &week))
    }

    pub fn export_config(&self) -> Result<ConfigExportDocument> {
        Ok(config_transfer::build_config_export(&self.config()?))
    }

    pub fn import_config_value(
        &mut self,
        payload: &serde_json::Value,
        dry_run: bool,
    ) -> Result<UserConfig> {
        let parsed = config_transfer::parse_config_import(payload)?;
        self.import_parsed(parsed, dry_run)
    }

    pub fn import_parsed(&mut self, parsed: ParsedConfig, dry_run: bool) -> Result<UserConfig> {
        let config = config_transfer::parsed_to_config(parsed);
        resolve::validate_config_ids(&config)?;
        self.write(dry_run, |conn| {
            store::put_config(conn, &config)?;
            Ok(config.clone())
        })
    }

    pub fn migrate_from(&mut self, path: &Path, dry_run: bool) -> Result<MigrateReport> {
        let text = fs::read_to_string(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                Error::not_found(format!("File not found: {}", path.display()))
            } else {
                Error::Io(error)
            }
        })?;
        let value: serde_json::Value = serde_json::from_str(&text)?;
        let source = paths::absolute_path(path);
        self.write(dry_run, |conn| migrate::apply_legacy(conn, &source, &value))
    }

    fn write<T>(
        &mut self,
        dry_run: bool,
        body: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        let tx = self.conn.transaction()?;
        match body(&tx) {
            Ok(value) => {
                if dry_run {
                    tx.rollback()?;
                } else {
                    store::bump(&tx)?;
                    tx.commit()?;
                }
                Ok(value)
            }
            Err(error) => Err(error),
        }
    }
}

fn hour_types_from_names(names: &[String], default_name: &str) -> Vec<HourType> {
    if names.is_empty() {
        return vec![normalize::default_hour_type(default_name)];
    }
    let mut hour_types: Vec<HourType> = Vec::new();
    for name in names {
        let mut hour_type = normalize::default_hour_type(name);
        if hour_types
            .iter()
            .any(|existing| existing.id == hour_type.id)
        {
            hour_type.id = new_id();
        }
        hour_types.push(hour_type);
    }
    hour_types
}

fn custom_name_map(custom_projects: &[WeekCustomProject]) -> HashMap<String, String> {
    custom_projects
        .iter()
        .filter_map(|project| {
            let id = safe_trim(&project.id);
            if id.is_empty() {
                None
            } else {
                let name = safe_trim(&project.name);
                Some((
                    id,
                    if name.is_empty() {
                        "Custom Project".to_string()
                    } else {
                        name
                    },
                ))
            }
        })
        .collect()
}

fn week_matches(week: &WeekDocument, query: &str) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return true;
    }
    let query = query.to_lowercase();
    week.week_start_date.to_lowercase().contains(&query)
        || week.week_end_date.to_lowercase().contains(&query)
        || week.rows.iter().any(|row| {
            row.project_name.to_lowercase().contains(&query)
                || row.task_name.to_lowercase().contains(&query)
                || row.hour_type_name.to_lowercase().contains(&query)
        })
}

fn recent_combos_from(weeks: &[WeekDocument], limit: usize) -> Vec<RecentCombo> {
    let mut ordered: Vec<&WeekDocument> = weeks.iter().collect();
    ordered.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for week in ordered {
        for row in &week.rows {
            let key = format!("{}:{}:{}", row.project_id, row.task_id, row.hour_type_id);
            if !seen.insert(key) {
                continue;
            }
            items.push(RecentCombo {
                project_id: row.project_id.clone(),
                project_name: row.project_name.clone(),
                task_id: row.task_id.clone(),
                task_name: row.task_name.clone(),
                hour_type_id: row.hour_type_id.clone(),
                hour_type_name: row.hour_type_name.clone(),
            });
            if items.len() >= limit {
                return items;
            }
        }
    }
    items
}

fn book_with(conn: &Connection, input: &BookInput<'_>) -> Result<BookingResult> {
    if input.date.trim().is_empty()
        || input.project.trim().is_empty()
        || input.task.trim().is_empty()
    {
        return Err(Error::validation(
            "date, projectId, and taskId are required",
        ));
    }
    let date = dateutil::parse_iso_date(input.date.trim())
        .ok_or_else(|| Error::validation("Date must use the YYYY-MM-DD format"))?;
    let Some(day_index) = dateutil::weekday_index(date) else {
        return Err(Error::validation(
            "Hours can only be booked on Monday through Friday",
        ));
    };
    let start = dateutil::week_start_monday(date);
    let config = store::load_config(conn)?;
    let project_index = resolve::project_index(&config, input.project)?;
    let task_index = resolve::task_index(&config.projects[project_index], input.task)?;
    let task = &config.projects[project_index].tasks[task_index];
    let hour_type = hour_type_for_booking(task, input.hour_type)?;
    let project_id = config.projects[project_index].id.clone();
    let project_name = config.projects[project_index].name.clone();
    let task_id = task.id.clone();
    let task_name = task.name.clone();
    let hour_type_id = hour_type.id.clone();
    let hour_type_name = hour_type.name.clone();
    let max_hours = config.max_hours_per_day[day_index];

    let mut week =
        store::load_week(conn, &to_iso(start))?.unwrap_or_else(|| WeekDocument::empty(start));
    let row_index = week.rows.iter().position(|row| {
        row.project_id == project_id && row.task_id == task_id && row.hour_type_id == hour_type_id
    });
    let previous = row_index
        .map(|index| week.rows[index].hours[day_index])
        .unwrap_or(Hours::ZERO);
    let current: i32 = week
        .rows
        .iter()
        .map(|row| row.hours[day_index].halves())
        .sum();
    let day_total_halves = current - previous.halves() + input.hours.halves();
    if day_total_halves > max_hours.halves() {
        return Err(Error::conflict(format!(
            "Booking would exceed the daily maximum ({} > {})",
            HourSum::from_halves(day_total_halves).to_js_number(),
            max_hours.to_js_number()
        )));
    }
    let day_total = Hours::from_halves(day_total_halves)?;
    let note = |update: NoteUpdate<'_>| match update {
        NoteUpdate::Keep => None,
        NoteUpdate::Set(value) => Some(value.map(safe_trim).filter(|note| !note.is_empty())),
    };
    if let Some(index) = row_index {
        let row = &mut week.rows[index];
        row.hours[day_index] = input.hours;
        row.project_name = project_name;
        row.task_name = task_name;
        row.hour_type_name = hour_type_name;
        if let Some(note) = note(input.note) {
            row.note = note;
        }
    } else {
        let mut hours = [Hours::ZERO; 5];
        hours[day_index] = input.hours;
        week.rows.push(StoredWeekRow {
            id: new_id(),
            project_id,
            project_name,
            task_id,
            task_name,
            hour_type_id,
            hour_type_name,
            hours,
            note: note(input.note).flatten(),
        });
    }
    week.updated_at = now_iso();
    store::put_week(conn, &week)?;
    Ok(BookingResult {
        date: to_iso(date),
        day_index,
        previous_hours: previous,
        hours: input.hours,
        day_total,
        max_hours_for_day: max_hours,
        week,
    })
}
