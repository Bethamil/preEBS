use serde::{Deserialize, Serialize};

use crate::dateutil::{self, to_iso};
use crate::hours::{HourSum, Hours};
use crate::text::now_iso;

pub const DEFAULT_USER_ID: &str = "local-user";
pub const DEFAULT_USER_NAME: &str = "Local User";
pub const DEFAULT_HOUR_TYPE_ID: &str = "default-straight-time";
pub const DEFAULT_HOUR_TYPE_NAME: &str = "DICTU Uren - (Straight Time)";
pub const WEEKDAY_LABELS: [&str; 5] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

pub fn default_hour_type_name() -> String {
    DEFAULT_HOUR_TYPE_NAME.to_string()
}

pub fn default_max_hours() -> [Hours; 5] {
    [Hours::EIGHT; 5]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HourType {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub hour_types: Vec<HourType>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserConfig {
    pub user_id: String,
    pub max_hours_per_day: [Hours; 5],
    #[serde(default = "default_hour_type_name")]
    pub default_hour_type_name: String,
    pub projects: Vec<Project>,
    pub updated_at: String,
}

impl UserConfig {
    pub fn empty() -> Self {
        Self {
            user_id: DEFAULT_USER_ID.to_string(),
            max_hours_per_day: default_max_hours(),
            default_hour_type_name: default_hour_type_name(),
            projects: Vec::new(),
            updated_at: now_iso(),
        }
    }

    pub fn display_name(project: &Project) -> String {
        project
            .label
            .as_ref()
            .filter(|label| !label.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| project.name.clone())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekCustomProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredWeekRow {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub task_id: String,
    pub task_name: String,
    pub hour_type_id: String,
    pub hour_type_name: String,
    pub hours: [Hours; 5],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekDocument {
    pub id: String,
    pub user_id: String,
    pub week_start_date: String,
    pub week_end_date: String,
    #[serde(default)]
    pub custom_projects: Vec<WeekCustomProject>,
    pub rows: Vec<StoredWeekRow>,
    pub created_at: String,
    pub updated_at: String,
}

impl WeekDocument {
    pub fn empty(week_start: chrono::NaiveDate) -> Self {
        let now = now_iso();
        let start = to_iso(week_start);
        Self {
            id: format!("{DEFAULT_USER_ID}:{start}"),
            user_id: DEFAULT_USER_ID.to_string(),
            week_end_date: to_iso(dateutil::week_end(week_start)),
            week_start_date: start,
            custom_projects: Vec::new(),
            rows: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        }
    }

    pub fn total_halves(&self) -> i32 {
        self.rows
            .iter()
            .flat_map(|row| row.hours.iter().map(|hours| hours.halves()))
            .sum()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekRowInput {
    #[serde(default)]
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub project_name: String,
    pub task_id: String,
    #[serde(default)]
    pub task_name: String,
    pub hour_type_id: String,
    #[serde(default)]
    pub hour_type_name: String,
    pub hours: [Hours; 5],
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HoursStatus {
    Under,
    Match,
    Over,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekSummary {
    pub week_start_date: String,
    pub week_end_date: String,
    pub total_hours: HourSum,
    pub required_hours: HourSum,
    pub hours_delta: HourSum,
    pub hours_status: HoursStatus,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentCombo {
    pub project_id: String,
    pub project_name: String,
    pub task_id: String,
    pub task_name: String,
    pub hour_type_id: String,
    pub hour_type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekView {
    pub config: UserConfig,
    pub week: WeekDocument,
    pub exists: bool,
    pub recent_combos: Vec<RecentCombo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookingResult {
    pub date: String,
    pub day_index: usize,
    pub previous_hours: Hours,
    pub hours: Hours,
    pub day_total: Hours,
    pub max_hours_for_day: Hours,
    pub week: WeekDocument,
}

/// `None` leaves the note alone. `Some(None)` clears it. `Some(Some(text))` sets it.
#[derive(Debug, Clone, Copy)]
pub enum NoteUpdate<'a> {
    Keep,
    Set(Option<&'a str>),
}

#[derive(Debug, Clone)]
pub struct BookInput<'a> {
    pub date: &'a str,
    pub project: &'a str,
    pub task: &'a str,
    pub hour_type: Option<&'a str>,
    pub hours: Hours,
    pub note: NoteUpdate<'a>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigExportDocument {
    #[serde(rename = "type")]
    pub doc_type: String,
    pub version: u64,
    pub exported_at: String,
    pub config: UserConfig,
}

pub const CONFIG_EXPORT_TYPE: &str = "preebs-config";
pub const CONFIG_EXPORT_VERSION: u64 = 1;
