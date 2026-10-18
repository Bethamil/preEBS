use std::collections::HashMap;

use serde::Serialize;

use crate::dateutil::{self, to_iso};
use crate::error::Result;
use crate::hours::HourSum;
use crate::model::{UserConfig, WeekDocument};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeekExportDocument {
    pub week_start: String,
    pub week_end: String,
    pub max_hours_per_day: Vec<String>,
    pub days: Vec<ExportDay>,
    pub totals: ExportTotals,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportDay {
    pub date: String,
    pub projects: Vec<ExportProject>,
    pub totals: ExportTotals,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportProject {
    pub project_id: String,
    pub project_name: String,
    pub tasks: Vec<ExportTask>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTask {
    pub task_id: String,
    pub task_name: String,
    pub hour_types: Vec<ExportHourType>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportHourType {
    pub hour_type_id: String,
    pub hour_type_name: String,
    pub hours: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExportTotals {
    pub hours: String,
}

#[derive(Clone)]
struct DraftHourType {
    hour_type_id: String,
    hour_type_name: String,
    halves: i32,
}

#[derive(Clone)]
struct DraftTask {
    task_id: String,
    task_name: String,
    hour_types: Vec<DraftHourType>,
}

#[derive(Clone)]
struct DraftProject {
    project_id: String,
    project_name: String,
    tasks: Vec<DraftTask>,
}

/// Port of `buildWeekExport` in `lib/export.ts`, including last-write-wins id indexes.
pub fn build_week_export(config: &UserConfig, week: &WeekDocument) -> WeekExportDocument {
    let start = dateutil::parse_iso_date(&week.week_start_date)
        .unwrap_or_else(|| dateutil::parse_iso_date("1970-01-05").expect("epoch monday"));
    let dates = dateutil::week_dates(start);
    let project_order = index_map(config.projects.iter().map(|project| project.id.as_str()));
    let task_order = index_map(
        config
            .projects
            .iter()
            .flat_map(|project| project.tasks.iter().map(|task| task.id.as_str())),
    );
    let hour_type_order = index_map(config.projects.iter().flat_map(|project| {
        project.tasks.iter().flat_map(|task| {
            task.hour_types
                .iter()
                .map(|hour_type| hour_type.id.as_str())
        })
    }));

    let mut days = Vec::with_capacity(5);
    let mut week_halves = 0;
    for (day_index, date) in dates.iter().enumerate() {
        let mut projects: Vec<DraftProject> = Vec::new();
        let mut day_halves = 0;
        for row in &week.rows {
            let halves = row.hours[day_index].halves();
            if halves <= 0 {
                continue;
            }
            let project = if let Some(project) = projects
                .iter_mut()
                .find(|project| project.project_id == row.project_id)
            {
                project
            } else {
                projects.push(DraftProject {
                    project_id: row.project_id.clone(),
                    project_name: row.project_name.clone(),
                    tasks: Vec::new(),
                });
                projects.last_mut().expect("just pushed")
            };
            let task = if let Some(task) = project
                .tasks
                .iter_mut()
                .find(|task| task.task_id == row.task_id)
            {
                task
            } else {
                project.tasks.push(DraftTask {
                    task_id: row.task_id.clone(),
                    task_name: row.task_name.clone(),
                    hour_types: Vec::new(),
                });
                project.tasks.last_mut().expect("just pushed")
            };
            if let Some(hour_type) = task
                .hour_types
                .iter_mut()
                .find(|hour_type| hour_type.hour_type_id == row.hour_type_id)
            {
                hour_type.halves += halves;
            } else {
                task.hour_types.push(DraftHourType {
                    hour_type_id: row.hour_type_id.clone(),
                    hour_type_name: row.hour_type_name.clone(),
                    halves,
                });
            }
            day_halves += halves;
        }
        sort_projects(&mut projects, &project_order, &task_order, &hour_type_order);
        week_halves += day_halves;
        days.push(ExportDay {
            date: to_iso(*date),
            projects: projects
                .into_iter()
                .map(|project| ExportProject {
                    project_id: project.project_id,
                    project_name: project.project_name,
                    tasks: project
                        .tasks
                        .into_iter()
                        .map(|task| ExportTask {
                            task_id: task.task_id,
                            task_name: task.task_name,
                            hour_types: task
                                .hour_types
                                .into_iter()
                                .map(|hour_type| ExportHourType {
                                    hour_type_id: hour_type.hour_type_id,
                                    hour_type_name: hour_type.hour_type_name,
                                    hours: crate::hours::format_halves(hour_type.halves),
                                })
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
            totals: ExportTotals {
                hours: crate::hours::format_halves(day_halves),
            },
        });
    }

    WeekExportDocument {
        week_start: week.week_start_date.clone(),
        week_end: week.week_end_date.clone(),
        max_hours_per_day: config
            .max_hours_per_day
            .iter()
            .map(|hours| hours.format_export())
            .collect(),
        days,
        totals: ExportTotals {
            hours: HourSum::from_halves(week_halves).format_export(),
        },
    }
}

fn index_map<'a>(ids: impl IntoIterator<Item = &'a str>) -> HashMap<&'a str, usize> {
    let mut map = HashMap::new();
    for (index, id) in ids.into_iter().enumerate() {
        map.insert(id, index);
    }
    map
}

fn order_of(map: &HashMap<&str, usize>, id: &str) -> usize {
    map.get(id).copied().unwrap_or(usize::MAX)
}

fn sort_projects(
    projects: &mut [DraftProject],
    project_order: &HashMap<&str, usize>,
    task_order: &HashMap<&str, usize>,
    hour_type_order: &HashMap<&str, usize>,
) {
    projects.sort_by(|left, right| {
        order_of(project_order, &left.project_id)
            .cmp(&order_of(project_order, &right.project_id))
            .then_with(|| {
                // Projects have no task id; both keys are empty and compare equal.
                order_of(task_order, "").cmp(&order_of(task_order, ""))
            })
    });
    for project in projects.iter_mut() {
        project.tasks.sort_by(|left, right| {
            order_of(task_order, &left.task_id).cmp(&order_of(task_order, &right.task_id))
        });
        for task in &mut project.tasks {
            task.hour_types.sort_by(|left, right| {
                order_of(hour_type_order, &left.hour_type_id)
                    .cmp(&order_of(hour_type_order, &right.hour_type_id))
            });
        }
    }
}

pub fn to_pretty_json<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}
