use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use preebs_core::{
    discover_legacy_db, legacy_json_candidates, project_index, resolve_db_path, task_index,
    write_new_file, BookInput, Error, FieldUpdate, Hours, NoteUpdate, PreEbs, WEEKDAY_LABELS,
};

const LONG_ABOUT: &str = "\
Book Monday-Friday hours into the local SQLite database shared with the PreEBS desktop app.
No server is required. `book` sets the cell to the given hours; it does not add, so repeating a command is safe.

Rules:
  hours      0 through 24 in steps of 0.5. Both 7.5 and 7,5 are accepted
  days       Monday through Friday only. Any date in the week selects that week
  hour type  optional only when the task has exactly one hour type
  daily max  a booking that would exceed maxHoursPerDay is rejected and changes nothing
  names      ids are stable. A name or project label is accepted only when it matches one entity
  files      export never overwrites an existing file
  dry-run    validates a write inside a transaction and rolls it back

Exit codes: 0 ok, 1 unexpected, 2 validation or usage, 3 not found, 4 conflict, 5 ambiguous name.
With --json, stdout is pretty JSON and errors are JSON on stderr: {\"error\",\"code\"}.";

#[derive(Parser)]
#[command(
    name = "preebs",
    version,
    about = "Book and export PreEBS hours without running the desktop app",
    long_about = LONG_ABOUT,
    subcommand_required = true,
    arg_required_else_help = true
)]
struct Cli {
    /// Pretty JSON on stdout. Errors are JSON on stderr.
    #[arg(long, global = true)]
    json: bool,

    /// Validate a change and print the result without saving it.
    #[arg(long, global = true)]
    dry_run: bool,

    /// Directory that contains preebs.sqlite. Overrides PREEBS_DATA_DIR.
    #[arg(long, global = true, value_name = "DIR")]
    data_dir: Option<PathBuf>,

    /// Database file. Overrides PREEBS_DB_PATH and --data-dir.
    #[arg(long, global = true, value_name = "FILE")]
    db: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Show or change settings, and import or export a preebs-config v1 file.
    Config {
        #[command(subcommand)]
        command: ConfigCmd,
    },
    /// List, add, rename, or remove projects.
    Project {
        #[command(subcommand)]
        command: ProjectCmd,
    },
    /// List, add, rename, or remove tasks on a project.
    Task {
        #[command(subcommand)]
        command: TaskCmd,
    },
    /// List, add, rename, or remove hour types on a task.
    #[command(name = "hour-type")]
    HourType {
        #[command(subcommand)]
        command: HourTypeCmd,
    },
    /// List saved weeks, newest Monday first.
    Weeks {
        /// Match week dates, project names, task names, or hour type names.
        #[arg(long)]
        query: Option<String>,
    },
    /// Show, copy, delete, or adjust one week. --date may be any day in that week.
    Week {
        #[command(subcommand)]
        command: WeekCmd,
    },
    /// Set hours for one Monday-Friday cell. This replaces the cell; it does not add.
    Book {
        /// Calendar date, YYYY-MM-DD.
        #[arg(long)]
        date: String,
        /// Project id, or a unique project name or label.
        #[arg(long)]
        project: String,
        /// Task id, or a unique task name on that project.
        #[arg(long)]
        task: String,
        /// Hour type id or unique name. Omit only when the task has exactly one.
        #[arg(long = "hour-type")]
        hour_type: Option<String>,
        /// Hours to store in the cell. 0 clears that day. 7.5 and 7,5 are the same.
        #[arg(long)]
        hours: String,
        /// Replace the row note. Pass an empty string to clear it. Omit to leave it.
        #[arg(long)]
        note: Option<String>,
    },
    /// Write the EBS extension JSON for the week containing --date.
    ///
    /// The file is the same shape the Chrome and Firefox extensions already import.
    /// The default path is ./preebs-WEEK-MONDAY.json. Existing files are left untouched.
    Export {
        #[arg(long)]
        date: String,
        /// Destination path. Refuses to replace a file that already exists.
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Import a legacy preebs-db.json once. Safe to run again.
    ///
    /// Without --from, searches the Electron app locations and ./data/preebs-db.json.
    /// Config is replaced by the file. Weeks in the file are upserted. Other weeks stay.
    Migrate {
        #[arg(long, value_name = "FILE")]
        from: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum ConfigCmd {
    /// Print max hours, the default hour type name, and the project tree.
    Show,
    /// Change the Monday-Friday maxima and/or the default hour type for new tasks.
    Set {
        /// Five values: 8,8,8,8,8 or 7.5,8,8,8,8 or 7,5;8;8;8;8 or "7,5 8 8 8 8".
        #[arg(long)]
        max_hours: Option<String>,
        /// Name given to a new task that does not list hour types.
        #[arg(long = "default-hour-type")]
        default_hour_type: Option<String>,
    },
    /// Write a preebs-config version 1 file. Does not overwrite.
    Export {
        #[arg(long, value_name = "FILE")]
        out: Option<PathBuf>,
    },
    /// Replace the current config from a preebs-config version 1 file. Weeks are kept.
    Import { file: PathBuf },
}

#[derive(Subcommand)]
enum ProjectCmd {
    /// List projects with their tasks and hour types.
    List,
    /// Add a project. The EBS name is --name; --label is the optional human name.
    Add {
        #[arg(long)]
        name: String,
        #[arg(long)]
        label: Option<String>,
        /// Stable id. A UUID is generated when this is omitted.
        #[arg(long)]
        id: Option<String>,
    },
    /// Rename a project or change its label. --label "" clears the label.
    Edit {
        /// Project id, or a unique name or label.
        id: String,
        /// EBS project name.
        #[arg(long)]
        name: Option<String>,
        /// Display name shown in the app. --label "" clears it.
        #[arg(long)]
        label: Option<String>,
        /// Hide the project until archived projects are shown.
        #[arg(long, conflicts_with = "unarchive")]
        archive: bool,
        /// Show the project in the normal list again.
        #[arg(long)]
        unarchive: bool,
    },
    /// Remove a project from config. Saved week rows are kept.
    Rm { id: String },
}

#[derive(Subcommand)]
enum TaskCmd {
    /// List tasks on one project.
    List {
        #[arg(long)]
        project: String,
    },
    /// Add a task. It keeps exactly one hour type. Extra --hour-type values collapse like import.
    Add {
        #[arg(long)]
        project: String,
        /// Exact EBS task name.
        #[arg(long)]
        name: String,
        /// Optional label shown in the app instead of the EBS name. Export keeps --name.
        #[arg(long)]
        label: Option<String>,
        /// Hour type name. Repeat to pass several; only one is stored.
        #[arg(long = "hour-type")]
        hour_type: Vec<String>,
        #[arg(long)]
        id: Option<String>,
    },
    /// Change the EBS name, the display label, or the single hour type.
    Edit {
        /// Task id, or a unique task name or label.
        id: String,
        /// Exact EBS task name.
        #[arg(long)]
        name: Option<String>,
        /// Display label. --label "" clears it. Omitting --label leaves it.
        #[arg(long)]
        label: Option<String>,
        /// Rename the task's only hour type. The hour type id is kept.
        #[arg(long = "hour-type")]
        hour_type: Option<String>,
    },
    /// Remove a task from config. Saved week rows are kept.
    Rm { id: String },
}

#[derive(Subcommand)]
enum HourTypeCmd {
    /// List hour types on one task.
    List {
        #[arg(long)]
        project: String,
        #[arg(long)]
        task: String,
    },
    /// Rejected. A task already has its one hour type; use hour-type edit.
    Add {
        #[arg(long)]
        project: String,
        #[arg(long)]
        task: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        id: Option<String>,
    },
    /// Rename an hour type. --project and --task are required when the id is shared.
    Edit {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        task: Option<String>,
    },
    /// Rejected. A task's only hour type cannot be removed.
    Rm {
        id: String,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        task: Option<String>,
    },
}

#[derive(Subcommand)]
enum WeekCmd {
    /// Print the week, whether it is saved, and recent project/task/hour-type combos.
    Show {
        #[arg(long)]
        date: String,
    },
    /// Replace this week with a copy of the previous week. Row ids are new.
    CopyPrevious {
        #[arg(long)]
        date: String,
    },
    /// Delete a saved week.
    Rm {
        #[arg(long)]
        date: String,
    },
    /// Add or remove a week-local project that is not in config.
    CustomProject {
        #[command(subcommand)]
        command: CustomProjectCmd,
    },
}

#[derive(Subcommand)]
enum CustomProjectCmd {
    /// Add a custom project to the week, creating the week if needed.
    Add {
        #[arg(long)]
        date: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        id: Option<String>,
    },
    /// Remove a custom project and its rows from the week.
    Rm {
        #[arg(long)]
        date: String,
        id: String,
    },
}

fn main() -> ExitCode {
    let json_flag = std::env::args().any(|arg| arg == "--json");
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) {
                let _ = error.print();
                return if error.exit_code() == 0 {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(2)
                };
            }
            if json_flag {
                let payload = serde_json::json!({
                    "error": error.to_string(),
                    "code": "usage",
                });
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&payload).unwrap_or_default()
                );
            } else {
                let _ = error.print();
            }
            return ExitCode::from(2);
        }
    };
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(cli.json, &error),
    }
}

fn fail(json: bool, error: &Error) -> ExitCode {
    if json {
        let payload = serde_json::json!({
            "error": error.to_string(),
            "code": error.code(),
        });
        eprintln!(
            "{}",
            serde_json::to_string_pretty(&payload).unwrap_or_default()
        );
    } else {
        eprintln!("{error}");
    }
    ExitCode::from(error.exit_code() as u8)
}

fn run(cli: &Cli) -> preebs_core::Result<()> {
    let path = resolve_db_path(cli.db.as_deref(), cli.data_dir.as_deref());
    let mut app = PreEbs::open(&path)?;
    let json = cli.json;
    let dry = cli.dry_run;
    match &cli.command {
        Command::Config { command } => match command {
            ConfigCmd::Show => {
                let config = app.config()?;
                respond(
                    json,
                    false,
                    serde_json::json!({"config": config}),
                    &human_config(&config),
                );
            }
            ConfigCmd::Set {
                max_hours,
                default_hour_type,
            } => {
                let max_hours = max_hours
                    .as_deref()
                    .map(preebs_core::parse_max_hours_list)
                    .transpose()?;
                let config = app.set_settings(max_hours, default_hour_type.as_deref(), dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"config": config}),
                    &human_config(&config),
                );
            }
            ConfigCmd::Export { out } => {
                let document = app.export_config()?;
                let day = document.exported_at.chars().take(10).collect::<String>();
                let path = out
                    .clone()
                    .unwrap_or_else(|| PathBuf::from(format!("preebs-config-{day}.json")));
                let body = preebs_core::to_pretty_json(&document)?;
                write_export(json, dry, &path, &body, "exportedAt", &document.exported_at)?;
            }
            ConfigCmd::Import { file } => {
                let text = std::fs::read_to_string(file).map_err(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        Error::not_found(format!("File not found: {}", file.display()))
                    } else {
                        Error::Io(error)
                    }
                })?;
                let payload: serde_json::Value = serde_json::from_str(&text)
                    .map_err(|error| Error::validation(format!("Invalid JSON: {error}")))?;
                let config = app.import_config_value(&payload, dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"config": config}),
                    &format!("Imported config with {} projects.", config.projects.len()),
                );
            }
        },
        Command::Project { command } => match command {
            ProjectCmd::List => {
                let projects = app.config()?.projects;
                respond(
                    json,
                    false,
                    serde_json::json!({"projects": projects}),
                    &human_projects(&projects),
                );
            }
            ProjectCmd::Add { name, label, id } => {
                let project = app.add_project(name, label.as_deref(), id.as_deref(), dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"project": project}),
                    &format!("Added project {} ({})", project.name, project.id),
                );
            }
            ProjectCmd::Edit {
                id,
                name,
                label,
                archive,
                unarchive,
            } => {
                let archived = if *archive {
                    Some(true)
                } else if *unarchive {
                    Some(false)
                } else {
                    None
                };
                let project = app.edit_project(
                    id,
                    field(name.as_deref()),
                    field(label.as_deref()),
                    archived,
                    dry,
                )?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"project": project}),
                    &format!("Updated project {} ({})", project.name, project.id),
                );
            }
            ProjectCmd::Rm { id } => {
                let project = app.remove_project(id, dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"project": project}),
                    &format!(
                        "Removed project {} ({}). Existing week rows were kept.",
                        project.name, project.id
                    ),
                );
            }
        },
        Command::Task { command } => match command {
            TaskCmd::List { project } => {
                let config = app.config()?;
                let index = project_index(&config, project)?;
                let project = &config.projects[index];
                respond(
                    json,
                    false,
                    serde_json::json!({"projectId": project.id, "tasks": project.tasks}),
                    &human_tasks(project),
                );
            }
            TaskCmd::Add {
                project,
                name,
                label,
                hour_type,
                id,
            } => {
                let task = app.add_task(
                    project,
                    name,
                    label.as_deref(),
                    hour_type,
                    id.as_deref(),
                    dry,
                )?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"task": task}),
                    &format!("Added task {} ({})", task.name, task.id),
                );
            }
            TaskCmd::Edit {
                id,
                name,
                label,
                hour_type,
            } => {
                let task = app.edit_task(
                    id,
                    field(name.as_deref()),
                    field(label.as_deref()),
                    hour_type.as_deref(),
                    dry,
                )?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"task": task}),
                    &format!("Updated task {} ({})", task.name, task.id),
                );
            }
            TaskCmd::Rm { id } => {
                let task = app.remove_task(id, dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"task": task}),
                    &format!("Removed task {} ({}).", task.name, task.id),
                );
            }
        },
        Command::HourType { command } => match command {
            HourTypeCmd::List { project, task } => {
                let config = app.config()?;
                let project_index = project_index(&config, project)?;
                let task_index = task_index(&config.projects[project_index], task)?;
                let project = &config.projects[project_index];
                let task = &project.tasks[task_index];
                respond(
                    json,
                    false,
                    serde_json::json!({
                        "projectId": project.id,
                        "taskId": task.id,
                        "hourTypes": task.hour_types
                    }),
                    &task
                        .hour_types
                        .iter()
                        .map(|hour_type| format!("{}  {}", hour_type.id, hour_type.name))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
            HourTypeCmd::Add {
                project,
                task,
                name,
                id,
            } => {
                let hour_type = app.add_hour_type(project, task, name, id.as_deref(), dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"hourType": hour_type}),
                    &format!("Added hour type {} ({})", hour_type.name, hour_type.id),
                );
            }
            HourTypeCmd::Edit {
                id,
                name,
                project,
                task,
            } => {
                let hour_type = app.edit_hour_type(
                    id,
                    name.as_deref(),
                    project.as_deref(),
                    task.as_deref(),
                    dry,
                )?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"hourType": hour_type}),
                    &format!("Updated hour type {} ({})", hour_type.name, hour_type.id),
                );
            }
            HourTypeCmd::Rm { id, project, task } => {
                let hour_type =
                    app.remove_hour_type(id, project.as_deref(), task.as_deref(), dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"hourType": hour_type}),
                    &format!("Removed hour type {} ({}).", hour_type.name, hour_type.id),
                );
            }
        },
        Command::Weeks { query } => {
            let weeks = app.list_weeks(query.as_deref().unwrap_or(""))?;
            let human = if weeks.is_empty() {
                "No weeks.".to_string()
            } else {
                weeks
                    .iter()
                    .map(|week| {
                        format!(
                            "{}  {} h / {} h  {}",
                            week.week_start_date,
                            week.total_hours.format_export(),
                            week.required_hours.format_export(),
                            match week.hours_status {
                                preebs_core::HoursStatus::Under => "under",
                                preebs_core::HoursStatus::Match => "match",
                                preebs_core::HoursStatus::Over => "over",
                            }
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            respond(json, false, serde_json::json!({"weeks": weeks}), &human);
        }
        Command::Week { command } => match command {
            WeekCmd::Show { date } => {
                let view = app.week_view(date)?;
                let human = human_week(&view);
                respond(json, false, serde_json::to_value(&view)?, &human);
            }
            WeekCmd::CopyPrevious { date } => {
                let week = app.copy_previous_week(date, dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"week": week}),
                    &format!(
                        "Copied previous week into {} ({} rows).",
                        week.week_start_date,
                        week.rows.len()
                    ),
                );
            }
            WeekCmd::Rm { date } => {
                let view = app.week_view(date)?;
                let start = view.week.week_start_date.clone();
                app.delete_week(date, dry)?;
                respond(
                    json,
                    dry,
                    serde_json::json!({"deleted": true, "weekStart": start}),
                    &format!("Deleted week {start}."),
                );
            }
            WeekCmd::CustomProject { command } => match command {
                CustomProjectCmd::Add { date, name, id } => {
                    let week = app.add_custom_project(date, name, id.as_deref(), dry)?;
                    respond(
                        json,
                        dry,
                        serde_json::json!({"week": week}),
                        &format!("Added custom project to {}.", week.week_start_date),
                    );
                }
                CustomProjectCmd::Rm { date, id } => {
                    let week = app.remove_custom_project(date, id, dry)?;
                    respond(
                        json,
                        dry,
                        serde_json::json!({"week": week}),
                        &format!("Removed custom project from {}.", week.week_start_date),
                    );
                }
            },
        },
        Command::Book {
            date,
            project,
            task,
            hour_type,
            hours,
            note,
        } => {
            let hours = Hours::parse_exact(hours)?;
            let booking = app.book(
                BookInput {
                    date,
                    project,
                    task,
                    hour_type: hour_type.as_deref(),
                    hours,
                    note: match note {
                        Some(note) => NoteUpdate::Set(Some(note)),
                        None => NoteUpdate::Keep,
                    },
                },
                dry,
            )?;
            let row = booking
                .week
                .rows
                .iter()
                .find(|row| row.hours[booking.day_index] == booking.hours)
                .or_else(|| booking.week.rows.last());
            let label = row
                .map(|row| {
                    format!(
                        "{} / {} / {}",
                        row.project_name, row.task_name, row.hour_type_name
                    )
                })
                .unwrap_or_default();
            let human = format!(
                "Set {} h on {} ({})\n{}\nDay total {} / {}",
                booking.hours.format_export(),
                booking.date,
                WEEKDAY_LABELS[booking.day_index],
                label,
                booking.day_total.format_export(),
                booking.max_hours_for_day.format_export()
            );
            respond(json, dry, serde_json::json!({"booking": booking}), &human);
        }
        Command::Export { date, output } => {
            let document = app.export_week(date)?;
            let path = output
                .clone()
                .unwrap_or_else(|| PathBuf::from(format!("preebs-{}.json", document.week_start)));
            let body = preebs_core::to_pretty_json(&document)?;
            write_export(json, dry, &path, &body, "weekStart", &document.week_start)?;
        }
        Command::Migrate { from } => {
            let source = match from {
                Some(path) => path.clone(),
                None => discover_legacy_db(&legacy_json_candidates()).ok_or_else(|| {
                    let tried = legacy_json_candidates()
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join("\n");
                    Error::not_found(format!(
                        "No legacy preebs-db.json found. Pass --from, or use one of:\n{tried}"
                    ))
                })?,
            };
            let report = app.migrate_from(&source, dry)?;
            let human = format!(
                "Migrated {} projects, {} tasks, {} hour types, {} weeks, {} rows from {}",
                report.projects,
                report.tasks,
                report.hour_types,
                report.weeks,
                report.rows,
                report.source
            );
            respond(json, dry, serde_json::to_value(&report)?, &human);
        }
    }
    Ok(())
}

fn field(value: Option<&str>) -> FieldUpdate<'_> {
    match value {
        Some(value) => FieldUpdate::Set(value),
        None => FieldUpdate::Keep,
    }
}

fn respond(json: bool, dry_run: bool, mut value: serde_json::Value, human: &str) {
    if json {
        if dry_run {
            if let Some(object) = value.as_object_mut() {
                object.insert("dryRun".to_string(), serde_json::Value::Bool(true));
            }
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        );
    } else {
        if dry_run {
            println!("Dry run; nothing was written.");
        }
        if !human.is_empty() {
            println!("{human}");
        }
    }
}

fn write_export(
    json: bool,
    dry_run: bool,
    path: &std::path::Path,
    body: &str,
    marker_key: &str,
    marker: &str,
) -> preebs_core::Result<()> {
    if path.exists() {
        return Err(Error::conflict(format!(
            "Output file already exists: {}",
            path.display()
        )));
    }
    if !dry_run {
        write_new_file(path, body)?;
    }
    let output = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut payload = serde_json::json!({"output": output});
    payload[marker_key] = serde_json::Value::String(marker.to_string());
    let verb = if dry_run { "Would write" } else { "Wrote" };
    respond(
        json,
        dry_run,
        payload,
        &format!("{verb} {}", output.display()),
    );
    Ok(())
}

fn human_config(config: &preebs_core::UserConfig) -> String {
    let max = WEEKDAY_LABELS
        .iter()
        .zip(config.max_hours_per_day.iter())
        .map(|(day, hours)| format!("{day} {}", hours.format_export()))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Default hour type: {}\nMax hours: {}\n{}",
        config.default_hour_type_name,
        max,
        human_projects(&config.projects)
    )
}

fn human_projects(projects: &[preebs_core::Project]) -> String {
    if projects.is_empty() {
        return "No projects.".to_string();
    }
    let mut lines = Vec::new();
    for project in projects {
        let label = project
            .label
            .as_ref()
            .map(|label| format!(" [{label}]"))
            .unwrap_or_default();
        lines.push(format!("{}  {}{label}", project.id, project.name));
        if project.tasks.is_empty() {
            lines.push("  (no tasks)".to_string());
            continue;
        }
        for task in &project.tasks {
            let label = task
                .label
                .as_ref()
                .map(|label| format!(" [{label}]"))
                .unwrap_or_default();
            lines.push(format!("  {}  {}{label}", task.id, task.name));
            for hour_type in &task.hour_types {
                lines.push(format!("      {}  {}", hour_type.id, hour_type.name));
            }
        }
    }
    lines.join("\n")
}

fn human_tasks(project: &preebs_core::Project) -> String {
    if project.tasks.is_empty() {
        format!("No tasks on {}.", project.name)
    } else {
        project
            .tasks
            .iter()
            .map(|task| {
                let hours = task
                    .hour_types
                    .iter()
                    .map(|hour_type| hour_type.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                let label = task
                    .label
                    .as_ref()
                    .map(|label| format!(" [{label}]"))
                    .unwrap_or_default();
                format!("{}  {}{label}  ({})", task.id, task.name, hours)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn human_week(view: &preebs_core::WeekView) -> String {
    let header = format!(
        "Week {} to {}{}",
        view.week.week_start_date,
        view.week.week_end_date,
        if view.exists { "" } else { " (not saved)" }
    );
    if view.week.rows.is_empty() {
        return format!("{header}\nNo rows.");
    }
    let mut lines = vec![
        header,
        format!(
            "{:<28} {:>6} {:>6} {:>6} {:>6} {:>6}",
            "Project / task / hour type", "Mon", "Tue", "Wed", "Thu", "Fri"
        ),
    ];
    for row in &view.week.rows {
        let name = format!(
            "{} / {} / {}",
            row.project_name, row.task_name, row.hour_type_name
        );
        let mut hours = String::new();
        for value in &row.hours {
            hours.push_str(&format!("{:>6}", value.format_export()));
        }
        lines.push(format!("{name:<28}{hours}"));
    }
    lines.join("\n")
}
