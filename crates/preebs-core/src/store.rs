use std::time::Duration;

use rusqlite::{params, Connection};

use crate::error::Result;
use crate::hours::Hours;
use crate::model::{
    HourType, Project, StoredWeekRow, Task, UserConfig, WeekCustomProject, WeekDocument,
    DEFAULT_USER_ID, DEFAULT_USER_NAME,
};
use crate::text::now_iso;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS configs (
    user_id TEXT PRIMARY KEY,
    max_hours TEXT NOT NULL,
    default_hour_type_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hour_types (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (task_id, id)
);
CREATE TABLE IF NOT EXISTS weeks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL UNIQUE,
    week_end TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS week_custom_projects (
    week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (week_id, id)
);
CREATE TABLE IF NOT EXISTS week_rows (
    id TEXT PRIMARY KEY,
    week_id TEXT NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    hour_type_id TEXT NOT NULL,
    hour_type_name TEXT NOT NULL,
    h0 INTEGER NOT NULL,
    h1 INTEGER NOT NULL,
    h2 INTEGER NOT NULL,
    h3 INTEGER NOT NULL,
    h4 INTEGER NOT NULL,
    note TEXT,
    position INTEGER NOT NULL,
    UNIQUE (week_id, project_id, task_id, hour_type_id)
);
";

pub fn initialize(conn: &Connection) -> Result<()> {
    let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(SCHEMA)?;
    seed(conn)?;
    Ok(())
}

fn seed(conn: &Connection) -> Result<()> {
    let users: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
    if users == 0 {
        let now = now_iso();
        conn.execute(
            "INSERT INTO users (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![DEFAULT_USER_ID, DEFAULT_USER_NAME, now],
        )?;
        put_config(conn, &UserConfig::empty())?;
    }
    let revision_rows: i64 = conn.query_row(
        "SELECT COUNT(*) FROM meta WHERE key = 'revision'",
        [],
        |row| row.get(0),
    )?;
    if revision_rows == 0 {
        conn.execute("INSERT INTO meta (key, value) VALUES ('revision', '0')", [])?;
    }
    Ok(())
}

pub fn revision(conn: &Connection) -> Result<u64> {
    let value: String =
        conn.query_row("SELECT value FROM meta WHERE key = 'revision'", [], |row| {
            row.get(0)
        })?;
    Ok(value.parse::<u64>().unwrap_or(0))
}

pub fn bump(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'",
        [],
    )?;
    Ok(())
}

pub fn load_config(conn: &Connection) -> Result<UserConfig> {
    let row = conn.query_row(
        "SELECT max_hours, default_hour_type_name, updated_at FROM configs WHERE user_id = ?1",
        params![DEFAULT_USER_ID],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    );
    let (max_hours, default_name, updated_at) = match row {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(UserConfig::empty()),
        Err(error) => return Err(error.into()),
    };
    let max_hours_per_day: [Hours; 5] = serde_json::from_str(&max_hours)?;
    Ok(UserConfig {
        user_id: DEFAULT_USER_ID.to_string(),
        max_hours_per_day,
        default_hour_type_name: default_name,
        projects: load_projects(conn)?,
        updated_at,
    })
}

fn load_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn
        .prepare("SELECT id, name, label FROM projects WHERE user_id = ?1 ORDER BY position ASC")?;
    let rows = stmt.query_map(params![DEFAULT_USER_ID], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut projects = Vec::new();
    for row in rows {
        let (id, name, label) = row?;
        projects.push(Project {
            tasks: load_tasks(conn, &id)?,
            id,
            name,
            label,
        });
    }
    Ok(projects)
}

fn load_tasks(conn: &Connection, project_id: &str) -> Result<Vec<Task>> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM tasks WHERE project_id = ?1 ORDER BY position ASC")?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut tasks = Vec::new();
    for row in rows {
        let (id, name) = row?;
        tasks.push(Task {
            hour_types: load_hour_types(conn, &id)?,
            id,
            name,
        });
    }
    Ok(tasks)
}

fn load_hour_types(conn: &Connection, task_id: &str) -> Result<Vec<HourType>> {
    let mut stmt =
        conn.prepare("SELECT id, name FROM hour_types WHERE task_id = ?1 ORDER BY position ASC")?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(HourType {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

pub fn put_config(conn: &Connection, config: &UserConfig) -> Result<()> {
    let max_hours = serde_json::to_string(&config.max_hours_per_day)?;
    conn.execute(
        "INSERT INTO configs (user_id, max_hours, default_hour_type_name, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
            max_hours = excluded.max_hours,
            default_hour_type_name = excluded.default_hour_type_name,
            updated_at = excluded.updated_at",
        params![
            DEFAULT_USER_ID,
            max_hours,
            config.default_hour_type_name,
            config.updated_at
        ],
    )?;
    conn.execute(
        "DELETE FROM projects WHERE user_id = ?1",
        params![DEFAULT_USER_ID],
    )?;
    for (position, project) in config.projects.iter().enumerate() {
        conn.execute(
            "INSERT INTO projects (id, user_id, name, label, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                project.id,
                DEFAULT_USER_ID,
                project.name,
                project.label,
                position as i64
            ],
        )?;
        for (task_position, task) in project.tasks.iter().enumerate() {
            conn.execute(
                "INSERT INTO tasks (id, project_id, name, position) VALUES (?1, ?2, ?3, ?4)",
                params![task.id, project.id, task.name, task_position as i64],
            )?;
            for (hour_position, hour_type) in task.hour_types.iter().enumerate() {
                conn.execute(
                    "INSERT INTO hour_types (task_id, id, name, position) VALUES (?1, ?2, ?3, ?4)",
                    params![task.id, hour_type.id, hour_type.name, hour_position as i64],
                )?;
            }
        }
    }
    Ok(())
}

pub fn load_week(conn: &Connection, week_start: &str) -> Result<Option<WeekDocument>> {
    let found = conn.query_row(
        "SELECT id, week_start, week_end, created_at, updated_at FROM weeks WHERE user_id = ?1 AND week_start = ?2",
        params![DEFAULT_USER_ID, week_start],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    );
    let (id, week_start, week_end, created_at, updated_at) = match found {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    Ok(Some(WeekDocument {
        custom_projects: load_custom_projects(conn, &id)?,
        rows: load_rows(conn, &id)?,
        id,
        user_id: DEFAULT_USER_ID.to_string(),
        week_start_date: week_start,
        week_end_date: week_end,
        created_at,
        updated_at,
    }))
}

fn load_custom_projects(conn: &Connection, week_id: &str) -> Result<Vec<WeekCustomProject>> {
    let mut stmt = conn.prepare(
        "SELECT id, name FROM week_custom_projects WHERE week_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![week_id], |row| {
        Ok(WeekCustomProject {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(Into::into)
}

fn load_rows(conn: &Connection, week_id: &str) -> Result<Vec<StoredWeekRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, project_name, task_id, task_name, hour_type_id, hour_type_name,
                h0, h1, h2, h3, h4, note
         FROM week_rows WHERE week_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![week_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i32>(7)?,
            row.get::<_, i32>(8)?,
            row.get::<_, i32>(9)?,
            row.get::<_, i32>(10)?,
            row.get::<_, i32>(11)?,
            row.get::<_, Option<String>>(12)?,
        ))
    })?;
    let mut stored = Vec::new();
    for row in rows {
        let (
            id,
            project_id,
            project_name,
            task_id,
            task_name,
            hour_type_id,
            hour_type_name,
            h0,
            h1,
            h2,
            h3,
            h4,
            note,
        ) = row?;
        stored.push(StoredWeekRow {
            id,
            project_id,
            project_name,
            task_id,
            task_name,
            hour_type_id,
            hour_type_name,
            hours: [
                Hours::from_halves(h0)?,
                Hours::from_halves(h1)?,
                Hours::from_halves(h2)?,
                Hours::from_halves(h3)?,
                Hours::from_halves(h4)?,
            ],
            note,
        });
    }
    Ok(stored)
}

pub fn list_weeks(conn: &Connection) -> Result<Vec<WeekDocument>> {
    let mut stmt =
        conn.prepare("SELECT week_start FROM weeks WHERE user_id = ?1 ORDER BY week_start DESC")?;
    let starts = stmt
        .query_map(params![DEFAULT_USER_ID], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut weeks = Vec::with_capacity(starts.len());
    for start in starts {
        if let Some(week) = load_week(conn, &start)? {
            weeks.push(week);
        }
    }
    Ok(weeks)
}

pub fn put_week(conn: &Connection, week: &WeekDocument) -> Result<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM weeks WHERE id = ?1",
        params![week.id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        conn.execute(
            "INSERT INTO weeks (id, user_id, week_start, week_end, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                week.id,
                DEFAULT_USER_ID,
                week.week_start_date,
                week.week_end_date,
                week.created_at,
                week.updated_at
            ],
        )?;
    } else {
        conn.execute(
            "UPDATE weeks SET week_end = ?2, updated_at = ?3 WHERE id = ?1",
            params![week.id, week.week_end_date, week.updated_at],
        )?;
        conn.execute("DELETE FROM week_rows WHERE week_id = ?1", params![week.id])?;
        conn.execute(
            "DELETE FROM week_custom_projects WHERE week_id = ?1",
            params![week.id],
        )?;
    }
    for (position, project) in week.custom_projects.iter().enumerate() {
        conn.execute(
            "INSERT INTO week_custom_projects (week_id, id, name, position) VALUES (?1, ?2, ?3, ?4)",
            params![week.id, project.id, project.name, position as i64],
        )?;
    }
    for (position, row) in week.rows.iter().enumerate() {
        conn.execute(
            "INSERT INTO week_rows (
                id, week_id, project_id, project_name, task_id, task_name,
                hour_type_id, hour_type_name, h0, h1, h2, h3, h4, note, position
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                row.id,
                week.id,
                row.project_id,
                row.project_name,
                row.task_id,
                row.task_name,
                row.hour_type_id,
                row.hour_type_name,
                row.hours[0].halves(),
                row.hours[1].halves(),
                row.hours[2].halves(),
                row.hours[3].halves(),
                row.hours[4].halves(),
                row.note,
                position as i64
            ],
        )?;
    }
    Ok(())
}

pub fn delete_week(conn: &Connection, week_start: &str) -> Result<bool> {
    let changed = conn.execute(
        "DELETE FROM weeks WHERE user_id = ?1 AND week_start = ?2",
        params![DEFAULT_USER_ID, week_start],
    )?;
    Ok(changed > 0)
}
