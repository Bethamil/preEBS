use std::fs;

use assert_cmd::Command;
use predicates::prelude::*;

fn preebs(dir: &std::path::Path) -> Command {
    let mut command = Command::cargo_bin("preebs").unwrap();
    command.arg("--data-dir").arg(dir);
    command
}

fn json_cmd(dir: &std::path::Path, args: &[&str]) -> serde_json::Value {
    let output = preebs(dir)
        .arg("--json")
        .args(args)
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    serde_json::from_slice(&output).unwrap()
}

#[test]
fn help_explains_booking_semantics() {
    let mut command = Command::cargo_bin("preebs").unwrap();
    command
        .arg("book")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("does not add"))
        .stdout(predicate::str::contains("7,5"));
}

#[test]
fn json_flow_books_exports_and_rejects_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    let config = json_cmd(root, &["config", "show"]);
    assert_eq!(
        config["config"]["defaultHourTypeName"],
        "DICTU Uren - (Straight Time)"
    );
    assert_eq!(
        config["config"]["maxHoursPerDay"],
        serde_json::json!([8, 8, 8, 8, 8])
    );

    json_cmd(
        root,
        &[
            "config",
            "set",
            "--max-hours",
            "8,8,8,8,6",
            "--default-hour-type",
            "Consulting",
        ],
    );

    json_cmd(
        root,
        &[
            "project",
            "add",
            "--name",
            "Alpha",
            "--label",
            "Alpha Label",
            "--id",
            "proj-a",
        ],
    );
    json_cmd(
        root,
        &["project", "add", "--name", "Alpha", "--id", "proj-b"],
    );
    let ambiguous = preebs(root)
        .args([
            "--json",
            "task",
            "add",
            "--project",
            "alpha",
            "--name",
            "Nope",
        ])
        .assert()
        .failure()
        .code(5);
    let stderr = String::from_utf8(ambiguous.get_output().stderr.clone()).unwrap();
    let error: serde_json::Value = serde_json::from_str(&stderr).unwrap();
    assert_eq!(error["code"], "ambiguous");

    json_cmd(
        root,
        &[
            "task",
            "add",
            "--project",
            "proj-a",
            "--name",
            "Design",
            "--id",
            "task-design",
            "--hour-type",
            "Consulting",
            "--hour-type",
            "Overtime",
        ],
    );
    json_cmd(
        root,
        &[
            "task",
            "add",
            "--project",
            "proj-b",
            "--name",
            "Plan",
            "--id",
            "task-plan",
        ],
    );

    let missing_type = preebs(root)
        .args([
            "--json",
            "book",
            "--date",
            "2026-09-21",
            "--project",
            "proj-a",
            "--task",
            "Design",
            "--hours",
            "1",
        ])
        .assert()
        .failure()
        .code(2);
    let stderr = String::from_utf8(missing_type.get_output().stderr.clone()).unwrap();
    assert!(stderr.contains("hourTypeId is required"));

    let booking = json_cmd(
        root,
        &[
            "book",
            "--date",
            "2026-09-23",
            "--project",
            "Alpha Label",
            "--task",
            "Design",
            "--hour-type",
            "Overtime",
            "--hours",
            "7,5",
            "--note",
            "Accessibility",
        ],
    );
    assert_eq!(booking["booking"]["hours"], 7.5);
    assert_eq!(booking["booking"]["dayIndex"], 2);
    assert_eq!(booking["booking"]["previousHours"], 0);
    assert_eq!(booking["booking"]["week"]["weekStartDate"], "2026-09-21");

    let again = json_cmd(
        root,
        &[
            "book",
            "--date",
            "2026-09-23",
            "--project",
            "proj-a",
            "--task",
            "task-design",
            "--hour-type",
            "Overtime",
            "--hours",
            "4",
        ],
    );
    assert_eq!(again["booking"]["previousHours"], 7.5);
    assert_eq!(again["booking"]["hours"], 4);
    assert_eq!(again["booking"]["week"]["rows"][0]["note"], "Accessibility");

    let revision_before = db_revision(root);
    let over = preebs(root)
        .args([
            "--json",
            "book",
            "--date",
            "2026-09-23",
            "--project",
            "proj-a",
            "--task",
            "Design",
            "--hour-type",
            "Consulting",
            "--hours",
            "8",
        ])
        .assert()
        .failure()
        .code(4);
    let stderr = String::from_utf8(over.get_output().stderr.clone()).unwrap();
    let error: serde_json::Value = serde_json::from_str(&stderr).unwrap();
    assert_eq!(error["code"], "conflict");
    assert_eq!(db_revision(root), revision_before);

    let weekend = preebs(root)
        .args([
            "--json",
            "book",
            "--date",
            "2026-09-26",
            "--project",
            "proj-b",
            "--task",
            "Plan",
            "--hours",
            "1",
        ])
        .assert()
        .failure()
        .code(2);
    assert!(String::from_utf8(weekend.get_output().stderr.clone())
        .unwrap()
        .contains("Monday through Friday"));

    let dry = json_cmd(
        root,
        &[
            "--dry-run",
            "book",
            "--date",
            "2026-09-24",
            "--project",
            "proj-b",
            "--task",
            "Plan",
            "--hours",
            "2",
        ],
    );
    assert_eq!(dry["dryRun"], true);
    assert_eq!(dry["booking"]["hours"], 2);
    let week = json_cmd(root, &["week", "show", "--date", "2026-09-24"]);
    assert!(week["week"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["taskId"] != "task-plan"));

    let out = root.join("week.json");
    let exported = json_cmd(
        root,
        &[
            "export",
            "--date",
            "2026-09-23",
            "--output",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(exported["weekStart"], "2026-09-21");
    let file = fs::read_to_string(&out).unwrap();
    assert!(file.contains("\"hours\": \"4\""));
    assert!(file.contains("Overtime"));
    assert!(!file.contains("Accessibility"));
    preebs(root)
        .args([
            "--json",
            "export",
            "--date",
            "2026-09-21",
            "--output",
            out.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .code(4);

    let config_path = root.join("config.json");
    json_cmd(
        root,
        &["config", "export", "--out", config_path.to_str().unwrap()],
    );
    let raw: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
    assert_eq!(raw["type"], "preebs-config");
    assert_eq!(raw["version"], 1);
    assert_eq!(raw["config"]["defaultHourTypeName"], "Consulting");
    assert_eq!(
        raw["config"]["projects"][0]["tasks"][0]["hourTypes"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    json_cmd(root, &["project", "rm", "proj-b"]);
    json_cmd(root, &["config", "import", config_path.to_str().unwrap()]);
    let restored = json_cmd(root, &["project", "list"]);
    assert_eq!(restored["projects"].as_array().unwrap().len(), 2);
}

fn db_revision(dir: &std::path::Path) -> u64 {
    let app = preebs_core::PreEbs::open(&dir.join("preebs.sqlite")).unwrap();
    app.revision().unwrap()
}

#[test]
fn migrate_then_export_matches_golden() {
    let dir = tempfile::tempdir().unwrap();
    let input = fs::read_to_string(format!(
        "{}/../preebs-core/tests/fixtures/export-input.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&input).unwrap();
    let legacy = serde_json::json!({
        "configs": {"local-user": value["config"]},
        "weeks": {"local-user:2026-09-21": value["week"]}
    });
    let source = dir.path().join("preebs-db.json");
    fs::write(&source, serde_json::to_string(&legacy).unwrap()).unwrap();
    json_cmd(dir.path(), &["migrate", "--from", source.to_str().unwrap()]);
    let output = dir.path().join("preebs-2026-09-21.json");
    json_cmd(
        dir.path(),
        &[
            "export",
            "--date",
            "2026-09-22",
            "--output",
            output.to_str().unwrap(),
        ],
    );
    let golden = fs::read_to_string(format!(
        "{}/../preebs-core/tests/fixtures/export-golden.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .replace("\r\n", "\n");
    assert_eq!(fs::read_to_string(output).unwrap(), golden);
}
