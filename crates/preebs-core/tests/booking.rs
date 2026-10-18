use preebs_core::{
    BookInput, Error, Hours, NoteUpdate, PreEbs, WeekCustomProject, WeekRowInput,
    DEFAULT_HOUR_TYPE_ID,
};

fn app() -> (tempfile::TempDir, PreEbs) {
    let dir = tempfile::tempdir().unwrap();
    let app = PreEbs::open(&dir.path().join("preebs.sqlite")).unwrap();
    (dir, app)
}

fn seed(app: &mut PreEbs) {
    app.add_project("Alpha", Some("Alpha Label"), Some("proj-a"), false)
        .unwrap();
    app.add_task(
        "Alpha Label",
        "Design",
        &["DICTU Uren - (Straight Time)".into(), "Overtime".into()],
        Some("task-design"),
        false,
    )
    .unwrap();
    app.add_task("proj-a", "Build", &[], Some("task-build"), false)
        .unwrap();
}

#[allow(clippy::too_many_arguments)]
fn book<'a>(
    app: &mut PreEbs,
    date: &'a str,
    project: &'a str,
    task: &'a str,
    hour_type: Option<&'a str>,
    hours: &str,
    note: NoteUpdate<'a>,
    dry_run: bool,
) -> Result<preebs_core::BookingResult, Error> {
    app.book(
        BookInput {
            date,
            project,
            task,
            hour_type,
            hours: Hours::parse_exact(hours)?,
            note,
        },
        dry_run,
    )
}

#[test]
fn book_sets_hours_and_is_idempotent() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let first = book(
        &mut app,
        "2026-09-23",
        "Alpha",
        "Build",
        None,
        "7,5",
        NoteUpdate::Keep,
        false,
    )
    .unwrap();
    assert_eq!(first.day_index, 2);
    assert_eq!(first.previous_hours, Hours::ZERO);
    assert_eq!(first.hours.format_export(), "7,5");
    assert_eq!(first.day_total.format_export(), "7,5");
    assert_eq!(first.week.week_start_date, "2026-09-21");
    assert_eq!(first.week.rows[0].hour_type_id, DEFAULT_HOUR_TYPE_ID);

    let second = book(
        &mut app,
        "2026-09-23",
        "proj-a",
        "task-build",
        None,
        "4",
        NoteUpdate::Set(Some("Notes")),
        false,
    )
    .unwrap();
    assert_eq!(second.previous_hours.format_export(), "7,5");
    assert_eq!(second.hours.format_export(), "4");
    assert_eq!(second.week.rows.len(), 1);
    assert_eq!(second.week.rows[0].note.as_deref(), Some("Notes"));
    assert_eq!(second.week.rows[0].hours[2].format_export(), "4");
}

#[test]
fn over_max_and_weekend_do_not_write() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let before = app.revision().unwrap();
    let error = book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "task-build",
        None,
        "9",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    assert_eq!(error.exit_code(), 4);
    assert!(error.to_string().contains("9 > 8"));
    assert!(app.week_view("2026-09-21").unwrap().week.rows.is_empty());
    assert_eq!(app.revision().unwrap(), before);

    let weekend = book(
        &mut app,
        "2026-09-26",
        "proj-a",
        "task-build",
        None,
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    assert_eq!(weekend.exit_code(), 2);
    assert!(weekend.to_string().contains("Monday through Friday"));
}

#[test]
fn hour_type_rules_and_ambiguous_names() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let missing = book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "Design",
        None,
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    assert!(missing.to_string().contains("hourTypeId is required"));

    book(
        &mut app,
        "2026-09-21",
        "Alpha",
        "Design",
        Some("Overtime"),
        "2",
        NoteUpdate::Keep,
        false,
    )
    .unwrap();
    let wrong = book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "task-build",
        Some("Overtime"),
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    assert_eq!(wrong.exit_code(), 3);

    app.add_project("Alpha", None, Some("proj-b"), false)
        .unwrap();
    let ambiguous = book(
        &mut app,
        "2026-09-21",
        "alpha",
        "task-build",
        None,
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    assert_eq!(ambiguous.exit_code(), 5);
}

#[test]
fn dry_run_rolls_back_and_copy_replaces() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let revision = app.revision().unwrap();
    book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "task-build",
        None,
        "3",
        NoteUpdate::Keep,
        true,
    )
    .unwrap();
    assert_eq!(app.revision().unwrap(), revision);
    assert!(!app.week_view("2026-09-21").unwrap().exists);

    book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "task-build",
        None,
        "3",
        NoteUpdate::Set(Some("keep")),
        false,
    )
    .unwrap();
    book(
        &mut app,
        "2026-09-22",
        "proj-a",
        "Design",
        Some("ot"),
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap_err();
    let overtime = app.config().unwrap().projects[0].tasks[0]
        .hour_types
        .iter()
        .find(|hour_type| hour_type.name == "Overtime")
        .unwrap()
        .id
        .clone();
    book(
        &mut app,
        "2026-09-22",
        "proj-a",
        "Design",
        Some(&overtime),
        "1",
        NoteUpdate::Keep,
        false,
    )
    .unwrap();

    let copied = app.copy_previous_week("2026-09-28", false).unwrap();
    assert_eq!(copied.week_start_date, "2026-09-28");
    assert_eq!(copied.rows.len(), 2);
    assert!(copied.rows.iter().all(|row| row.id.len() > 8));
    let source = app.week_view("2026-09-21").unwrap();
    assert!(source
        .week
        .rows
        .iter()
        .all(|row| copied.rows.iter().all(|copied_row| copied_row.id != row.id)));
}

#[test]
fn save_merges_duplicate_rows_and_recent_combos() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let config = app.config().unwrap();
    let straight = DEFAULT_HOUR_TYPE_ID;
    let rows = vec![
        WeekRowInput {
            id: "a".into(),
            project_id: "proj-a".into(),
            project_name: "stale".into(),
            task_id: "task-build".into(),
            task_name: "stale".into(),
            hour_type_id: straight.into(),
            hour_type_name: "stale".into(),
            hours: [
                Hours::parse_exact("1").unwrap(),
                Hours::ZERO,
                Hours::ZERO,
                Hours::ZERO,
                Hours::ZERO,
            ],
            note: Some("first".into()),
        },
        WeekRowInput {
            id: "b".into(),
            project_id: "proj-a".into(),
            project_name: "stale".into(),
            task_id: "task-build".into(),
            task_name: "stale".into(),
            hour_type_id: straight.into(),
            hour_type_name: "stale".into(),
            hours: [
                Hours::parse_exact("1.5").unwrap(),
                Hours::ZERO,
                Hours::ZERO,
                Hours::ZERO,
                Hours::ZERO,
            ],
            note: Some("second".into()),
        },
    ];
    let week = app.save_week("2026-09-23", &rows, &[], false).unwrap();
    assert_eq!(week.rows.len(), 1);
    assert_eq!(week.rows[0].id, "a");
    assert_eq!(week.rows[0].hours[0].format_export(), "2,5");
    assert_eq!(week.rows[0].project_name, "Alpha");
    assert_eq!(week.rows[0].task_name, "Build");
    assert_eq!(week.rows[0].note.as_deref(), Some("first"));
    let _ = config;

    let view = app.week_view("2026-09-25").unwrap();
    assert_eq!(view.recent_combos.len(), 1);
    assert_eq!(view.recent_combos[0].task_name, "Build");
}

#[test]
fn migration_is_idempotent_and_dry_run_writes_nothing() {
    let input = std::fs::read_to_string(format!(
        "{}/tests/fixtures/export-input.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&input).unwrap();
    let legacy = serde_json::json!({
        "users": [{"id": "local-user", "name": "Local User", "createdAt": "2026-09-20T08:00:00.000Z"}],
        "configs": {"local-user": value["config"]},
        "weeks": {"local-user:2026-09-21": value["week"]}
    });
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("preebs-db.json");
    std::fs::write(&source, serde_json::to_string_pretty(&legacy).unwrap()).unwrap();

    let mut app = PreEbs::open(&dir.path().join("preebs.sqlite")).unwrap();
    let revision = app.revision().unwrap();
    let dry = app.migrate_from(&source, true).unwrap();
    assert!(dry.projects >= 2);
    assert_eq!(app.revision().unwrap(), revision);
    assert!(app.config().unwrap().projects.is_empty());

    let report = app.migrate_from(&source, false).unwrap();
    assert_eq!(report.projects, 2);
    assert_eq!(report.weeks, 1);
    assert!(report.rows >= 5);
    let again = app.migrate_from(&source, false).unwrap();
    assert_eq!(again.weeks, 1);
    assert_eq!(again.rows, report.rows);
    let week = app.week_view("2026-09-23").unwrap();
    assert!(week.exists);
    assert_eq!(
        build_export(&app),
        std::fs::read_to_string(format!(
            "{}/tests/fixtures/export-golden.json",
            env!("CARGO_MANIFEST_DIR")
        ))
        .unwrap()
        .replace("\r\n", "\n")
    );

    app.add_custom_project("2026-10-05", "Only local", None, false)
        .unwrap();
    app.migrate_from(&source, false).unwrap();
    assert!(app.week_view("2026-10-05").unwrap().exists);
}

fn build_export(app: &PreEbs) -> String {
    preebs_core::to_pretty_json(&app.export_week("2026-09-21").unwrap()).unwrap()
}

#[test]
fn custom_project_and_week_summary() {
    let (_dir, mut app) = app();
    seed(&mut app);
    app.set_settings(
        Some([
            Hours::EIGHT,
            Hours::EIGHT,
            Hours::EIGHT,
            Hours::EIGHT,
            Hours::parse_exact("6").unwrap(),
        ]),
        None,
        false,
    )
    .unwrap();
    book(
        &mut app,
        "2026-09-21",
        "proj-a",
        "Build",
        None,
        "8",
        NoteUpdate::Keep,
        false,
    )
    .unwrap();
    let week = app
        .add_custom_project("2026-09-21", "Side Quest", Some("custom-1"), false)
        .unwrap();
    assert_eq!(week.custom_projects[0].name, "Side Quest");
    let rows = vec![WeekRowInput {
        id: "custom-row".into(),
        project_id: "custom-1".into(),
        project_name: "Side Quest".into(),
        task_id: "custom-task".into(),
        task_name: "Misc".into(),
        hour_type_id: "custom-ht".into(),
        hour_type_name: "DICTU Uren - (Straight Time)".into(),
        hours: [
            Hours::ZERO,
            Hours::ZERO,
            Hours::ZERO,
            Hours::ZERO,
            Hours::parse_exact("0,5").unwrap(),
        ],
        note: None,
    }];
    app.save_week(
        "2026-09-21",
        &rows
            .into_iter()
            .chain(
                app.week_view("2026-09-21")
                    .unwrap()
                    .week
                    .rows
                    .into_iter()
                    .map(|row| WeekRowInput {
                        id: row.id,
                        project_id: row.project_id,
                        project_name: row.project_name,
                        task_id: row.task_id,
                        task_name: row.task_name,
                        hour_type_id: row.hour_type_id,
                        hour_type_name: row.hour_type_name,
                        hours: row.hours,
                        note: row.note,
                    }),
            )
            .collect::<Vec<_>>(),
        &[WeekCustomProject {
            id: "custom-1".into(),
            name: "Side Quest".into(),
        }],
        false,
    )
    .unwrap();
    let weeks = app.list_weeks("side").unwrap();
    assert_eq!(weeks.len(), 1);
    assert_eq!(weeks[0].hours_status, preebs_core::HoursStatus::Under);

    app.remove_custom_project("2026-09-21", "Side Quest", false)
        .unwrap();
    let week = app.week_view("2026-09-21").unwrap();
    assert!(week.week.custom_projects.is_empty());
    assert!(week
        .week
        .rows
        .iter()
        .all(|row| row.project_id != "custom-1"));

    let missing = app.delete_week("2026-10-05", false).unwrap_err();
    assert_eq!(missing.exit_code(), 3);
    app.delete_week("2026-09-21", false).unwrap();
    assert!(!app.week_view("2026-09-21").unwrap().exists);
}

#[test]
fn cannot_remove_last_hour_type_and_names_resolve() {
    let (_dir, mut app) = app();
    seed(&mut app);
    let error = app
        .remove_hour_type(
            DEFAULT_HOUR_TYPE_ID,
            Some("proj-a"),
            Some("task-build"),
            false,
        )
        .unwrap_err();
    assert_eq!(error.exit_code(), 2);
    app.remove_hour_type("Overtime", Some("Alpha"), Some("Design"), false)
        .unwrap();
    assert_eq!(
        app.config().unwrap().projects[0].tasks[0].hour_types.len(),
        1
    );
    let ambiguous = app
        .edit_hour_type(DEFAULT_HOUR_TYPE_ID, Some("Straight"), None, None, false)
        .unwrap_err();
    assert_eq!(ambiguous.exit_code(), 5);
}

#[test]
fn another_connection_sees_a_cli_style_write() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("preebs.sqlite");
    let mut writer = PreEbs::open(&path).unwrap();
    let reader = PreEbs::open(&path).unwrap();
    let before = reader.revision().unwrap();
    writer
        .add_project("Shared", None, Some("proj-shared"), false)
        .unwrap();
    assert!(reader.revision().unwrap() > before);
    assert_eq!(reader.config().unwrap().projects[0].name, "Shared");
}
