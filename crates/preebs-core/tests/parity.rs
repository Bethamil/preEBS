use std::path::PathBuf;

use preebs_core::{
    build_config_export, build_week_export, parse_config_import, to_pretty_json, Hours, PreEbs,
    UserConfig, WeekDocument, DEFAULT_HOUR_TYPE_ID, DEFAULT_HOUR_TYPE_NAME,
};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn read(name: &str) -> String {
    // Windows checkouts may rewrite LF fixtures to CRLF. Exports are LF.
    std::fs::read_to_string(fixture(name))
        .unwrap()
        .replace("\r\n", "\n")
}

#[test]
fn week_export_matches_typescript_golden() {
    let input: serde_json::Value = serde_json::from_str(&read("export-input.json")).unwrap();
    let config: UserConfig = serde_json::from_value(input["config"].clone()).unwrap();
    let week: WeekDocument = serde_json::from_value(input["week"].clone()).unwrap();
    let exported = build_week_export(&config, &week);
    let pretty = to_pretty_json(&exported).unwrap();
    assert_eq!(pretty, read("export-golden.json"));
}

#[test]
fn config_import_matches_typescript_parser() {
    let golden: serde_json::Value =
        serde_json::from_str(&read("config-export-golden.json")).unwrap();
    let parsed = parse_config_import(&golden).unwrap();
    assert_eq!(parsed.max_hours_per_day, vec![8.0, 7.5, 8.0, 8.0, 6.0]);
    assert!(parsed.default_hour_type_name.is_none());
    assert_eq!(parsed.projects.len(), 2);
    assert_eq!(parsed.projects[0].name, "Bravo");
    assert_eq!(parsed.projects[0].label.as_deref(), Some("Bravo Label"));
    assert_eq!(parsed.projects[1].tasks[0].hour_types.len(), 2);
    assert_eq!(parsed.projects[1].tasks[0].hour_types[1].id, "ot-1");

    let dirty: serde_json::Value = serde_json::from_str(&read("config-import-dirty.json")).unwrap();
    let dirty = parse_config_import(&dirty).unwrap();
    assert_eq!(dirty.max_hours_per_day, vec![8.0, 7.25, 8.0]);
    assert_eq!(dirty.projects.len(), 1);
    assert_eq!(dirty.projects[0].name, "Alpha One");
    assert!(dirty.projects[0].label.is_none());
    assert_eq!(dirty.projects[0].tasks.len(), 1);
    assert_eq!(dirty.projects[0].tasks[0].id, "");
    assert_eq!(dirty.projects[0].tasks[0].name, "Task");
    assert_eq!(dirty.projects[0].tasks[0].hour_types.len(), 1);
    assert_eq!(dirty.projects[0].tasks[0].hour_types[0].name, "Straight");

    assert!(parse_config_import(
        &serde_json::from_str(&read("config-import-bad-type.json")).unwrap()
    )
    .is_err());
    assert!(parse_config_import(
        &serde_json::from_str(&read("config-import-bad-version.json")).unwrap()
    )
    .is_err());
}

#[test]
fn config_roundtrip_keeps_multiple_hour_types_and_default_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut app = PreEbs::open(&dir.path().join("preebs.sqlite")).unwrap();
    let mut config = app.config().unwrap();
    config.default_hour_type_name = "Consulting".to_string();
    config.max_hours_per_day = [
        Hours::parse_exact("7.5").unwrap(),
        Hours::EIGHT,
        Hours::EIGHT,
        Hours::EIGHT,
        Hours::EIGHT,
    ];
    config.projects.push(preebs_core::Project {
        id: "p1".into(),
        name: "Alpha".into(),
        label: Some("Alpha Label".into()),
        tasks: vec![preebs_core::Task {
            id: "t1".into(),
            name: "Design".into(),
            hour_types: vec![
                preebs_core::HourType {
                    id: DEFAULT_HOUR_TYPE_ID.into(),
                    name: DEFAULT_HOUR_TYPE_NAME.into(),
                },
                preebs_core::HourType {
                    id: "ot-1".into(),
                    name: "Overtime".into(),
                },
            ],
        }],
    });
    let saved = app.save_config(config, false).unwrap();
    assert_eq!(saved.projects[0].tasks[0].hour_types.len(), 2);
    assert_eq!(saved.default_hour_type_name, "Consulting");

    let document = build_config_export(&saved);
    let value = serde_json::to_value(&document).unwrap();
    assert_eq!(value["type"], "preebs-config");
    assert_eq!(value["version"], 1);
    assert_eq!(value["config"]["defaultHourTypeName"], "Consulting");

    let parsed = parse_config_import(&value).unwrap();
    let imported = app.import_parsed(parsed, false).unwrap();
    assert_eq!(imported.default_hour_type_name, "Consulting");
    assert_eq!(imported.max_hours_per_day[0].format_export(), "7,5");
    assert_eq!(imported.projects[0].tasks[0].hour_types.len(), 2);
    assert_eq!(imported.projects[0].label.as_deref(), Some("Alpha Label"));

    let task = app.add_task("p1", "Build", &[], None, false).unwrap();
    assert_eq!(task.hour_types.len(), 1);
    assert_eq!(task.hour_types[0].name, "Consulting");
    assert_ne!(task.hour_types[0].id, DEFAULT_HOUR_TYPE_ID);

    app.set_settings(None, Some(DEFAULT_HOUR_TYPE_NAME), false)
        .unwrap();
    let straight = app.add_task("Alpha", "Plan", &[], None, false).unwrap();
    assert_eq!(straight.hour_types[0].id, DEFAULT_HOUR_TYPE_ID);
    assert_eq!(straight.hour_types[0].name, DEFAULT_HOUR_TYPE_NAME);
}

#[test]
fn dirty_import_clamps_and_fills_defaults() {
    let dirty: serde_json::Value = serde_json::from_str(&read("config-import-dirty.json")).unwrap();
    let parsed = parse_config_import(&dirty).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut app = PreEbs::open(&dir.path().join("preebs.sqlite")).unwrap();
    let config = app.import_parsed(parsed, false).unwrap();
    assert_eq!(
        config
            .max_hours_per_day
            .iter()
            .map(|hours| hours.format_export())
            .collect::<Vec<_>>(),
        vec!["8", "7,5", "8", "8", "8"]
    );
    assert_eq!(config.default_hour_type_name, DEFAULT_HOUR_TYPE_NAME);
    assert_eq!(config.projects[0].tasks[0].hour_types[0].name, "Straight");
    assert!(!config.projects[0].tasks[0].id.is_empty());
}
