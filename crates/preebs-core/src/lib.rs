//! Domain logic for PreEBS: config, Monday–Friday weeks, booking rules,
//! EBS week export, config transfer, and the SQLite database shared by the
//! CLI and the desktop app.

mod config_transfer;
mod dateutil;
mod error;
mod export;
mod hours;
mod migrate;
mod model;
mod normalize;
mod paths;
mod resolve;
mod service;
mod store;
mod text;

pub use config_transfer::{build_config_export, parse_config_import};
pub use dateutil::{
    format_week_range, iso_week, parse_iso_date, shift_week, week_dates, week_end,
    week_start_monday, weekday_index,
};
pub use error::{Error, Result};
pub use export::{build_week_export, to_pretty_json, WeekExportDocument};
pub use hours::{format_halves, parse_max_hours_list, HourSum, Hours};
pub use migrate::{discover_legacy_db, legacy_json_candidates, MigrateReport};
pub use model::*;
pub use paths::{resolve_db_path, write_new_file};
pub use resolve::{project_index, task_index};
pub use service::{FieldUpdate, PreEbs};
