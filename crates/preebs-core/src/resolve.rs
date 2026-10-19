use crate::error::{Error, Result};
use crate::model::{HourType, Project, Task, UserConfig};
use crate::text::{names_equal, safe_trim};

pub fn project_index(config: &UserConfig, token: &str) -> Result<usize> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::validation("A project id or name is required"));
    }
    if let Some(index) = config
        .projects
        .iter()
        .position(|project| project.id == token)
    {
        return Ok(index);
    }
    let matches: Vec<usize> = config
        .projects
        .iter()
        .enumerate()
        .filter(|(_, project)| {
            names_equal(&project.name, token)
                || project
                    .label
                    .as_ref()
                    .is_some_and(|label| names_equal(label, token))
        })
        .map(|(index, _)| index)
        .collect();
    match matches.as_slice() {
        [index] => Ok(*index),
        [] => Err(Error::not_found(format!("Unknown project ID: {token}"))),
        _ => Err(Error::ambiguous(format!(
            "Ambiguous project name \"{token}\". Pass a project id."
        ))),
    }
}

pub fn task_index(project: &Project, token: &str) -> Result<usize> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::validation("A task id or name is required"));
    }
    if let Some(index) = project.tasks.iter().position(|task| task.id == token) {
        return Ok(index);
    }
    let matches: Vec<usize> = project
        .tasks
        .iter()
        .enumerate()
        .filter(|(_, task)| {
            names_equal(&task.name, token)
                || task
                    .label
                    .as_ref()
                    .is_some_and(|label| names_equal(label, token))
        })
        .map(|(index, _)| index)
        .collect();
    match matches.as_slice() {
        [index] => Ok(*index),
        [] => Err(Error::not_found(format!(
            "Task {token} does not belong to project {}",
            project.id
        ))),
        _ => Err(Error::ambiguous(format!(
            "Ambiguous task name \"{token}\" in project {}. Pass a task id.",
            project.id
        ))),
    }
}

pub fn task_location(config: &UserConfig, token: &str) -> Result<(usize, usize)> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::validation("A task id or name is required"));
    }
    let id_hits: Vec<(usize, usize)> = config
        .projects
        .iter()
        .enumerate()
        .flat_map(|(project_index, project)| {
            project
                .tasks
                .iter()
                .enumerate()
                .filter(move |(_, task)| task.id == token)
                .map(move |(task_index, _)| (project_index, task_index))
        })
        .collect();
    if id_hits.len() == 1 {
        return Ok(id_hits[0]);
    }
    if id_hits.len() > 1 {
        return Err(Error::ambiguous(format!(
            "Ambiguous task id \"{token}\". Pass --project as well."
        )));
    }
    let name_hits: Vec<(usize, usize)> = config
        .projects
        .iter()
        .enumerate()
        .flat_map(|(project_index, project)| {
            project
                .tasks
                .iter()
                .enumerate()
                .filter(move |(_, task)| {
                    names_equal(&task.name, token)
                        || task
                            .label
                            .as_ref()
                            .is_some_and(|label| names_equal(label, token))
                })
                .map(move |(task_index, _)| (project_index, task_index))
        })
        .collect();
    match name_hits.as_slice() {
        [(project_index, task_index)] => Ok((*project_index, *task_index)),
        [] => Err(Error::not_found(format!("Unknown task: {token}"))),
        _ => Err(Error::ambiguous(format!(
            "Ambiguous task name \"{token}\". Pass a task id."
        ))),
    }
}

pub fn hour_type_for_booking<'a>(task: &'a Task, token: Option<&str>) -> Result<&'a HourType> {
    let token = token.map(str::trim).filter(|value| !value.is_empty());
    let Some(token) = token else {
        return if task.hour_types.len() == 1 {
            Ok(&task.hour_types[0])
        } else {
            Err(Error::validation(
                "hourTypeId is required when a task has zero or multiple hour types",
            ))
        };
    };
    if let Some(hour_type) = task
        .hour_types
        .iter()
        .find(|hour_type| hour_type.id == token)
    {
        return Ok(hour_type);
    }
    let matches: Vec<&HourType> = task
        .hour_types
        .iter()
        .filter(|hour_type| names_equal(&hour_type.name, token))
        .collect();
    match matches.as_slice() {
        [hour_type] => Ok(*hour_type),
        [] => Err(Error::not_found(format!(
            "Unknown hour type ID for task {}",
            task.id
        ))),
        _ => Err(Error::ambiguous(format!(
            "Ambiguous hour type name \"{token}\" on task {}. Pass an hour type id.",
            task.id
        ))),
    }
}

pub fn hour_type_location(
    config: &UserConfig,
    token: &str,
    project_token: Option<&str>,
    task_token: Option<&str>,
) -> Result<(usize, usize, usize)> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::validation("An hour type id or name is required"));
    }
    if let (Some(project_token), Some(task_token)) = (project_token, task_token) {
        let project_index = project_index(config, project_token)?;
        let task_index = task_index(&config.projects[project_index], task_token)?;
        let task = &config.projects[project_index].tasks[task_index];
        let hour_type = hour_type_for_booking(task, Some(token))?;
        let hour_index = task
            .hour_types
            .iter()
            .position(|item| item.id == hour_type.id)
            .expect("hour type came from this task");
        return Ok((project_index, task_index, hour_index));
    }
    if project_token.is_some() ^ task_token.is_some() {
        return Err(Error::validation(
            "Pass both --project and --task to disambiguate an hour type, or neither when the id is unique",
        ));
    }

    let id_hits = collect_hour_types(config, |hour_type| hour_type.id == token);
    if id_hits.len() == 1 {
        return Ok(id_hits[0]);
    }
    if id_hits.len() > 1 {
        return Err(Error::ambiguous(format!(
            "Ambiguous hour type id \"{token}\". Pass --project and --task."
        )));
    }
    let name_hits = collect_hour_types(config, |hour_type| names_equal(&hour_type.name, token));
    match name_hits.as_slice() {
        [hit] => Ok(*hit),
        [] => Err(Error::not_found(format!("Unknown hour type: {token}"))),
        _ => Err(Error::ambiguous(format!(
            "Ambiguous hour type name \"{token}\". Pass --project and --task."
        ))),
    }
}

fn collect_hour_types(
    config: &UserConfig,
    predicate: impl Fn(&HourType) -> bool,
) -> Vec<(usize, usize, usize)> {
    let mut hits = Vec::new();
    for (project_index, project) in config.projects.iter().enumerate() {
        for (task_index, task) in project.tasks.iter().enumerate() {
            for (hour_index, hour_type) in task.hour_types.iter().enumerate() {
                if predicate(hour_type) {
                    hits.push((project_index, task_index, hour_index));
                }
            }
        }
    }
    hits
}

pub fn ensure_unique_project_id(config: &UserConfig, id: &str) -> Result<()> {
    if config.projects.iter().any(|project| project.id == id) {
        Err(Error::conflict(format!("Project id already exists: {id}")))
    } else {
        Ok(())
    }
}

pub fn ensure_unique_task_id(config: &UserConfig, id: &str) -> Result<()> {
    if config
        .projects
        .iter()
        .any(|project| project.tasks.iter().any(|task| task.id == id))
    {
        Err(Error::conflict(format!("Task id already exists: {id}")))
    } else {
        Ok(())
    }
}

pub fn require_name(value: &str, label: &str) -> Result<String> {
    let name = safe_trim(value);
    if name.is_empty() {
        Err(Error::validation(format!("{label} is required")))
    } else {
        Ok(name)
    }
}

pub fn validate_config_ids(config: &UserConfig) -> Result<()> {
    let mut project_ids = std::collections::HashSet::new();
    let mut task_ids = std::collections::HashSet::new();
    for project in &config.projects {
        if !project_ids.insert(project.id.as_str()) {
            return Err(Error::validation(format!(
                "Duplicate project id: {}",
                project.id
            )));
        }
        for task in &project.tasks {
            if !task_ids.insert(task.id.as_str()) {
                return Err(Error::validation(format!("Duplicate task id: {}", task.id)));
            }
            let mut hour_ids = std::collections::HashSet::new();
            for hour_type in &task.hour_types {
                if !hour_ids.insert(hour_type.id.as_str()) {
                    return Err(Error::validation(format!(
                        "Duplicate hour type id {} on task {}",
                        hour_type.id, task.id
                    )));
                }
            }
        }
    }
    Ok(())
}

pub fn clean_id(value: &str) -> Result<String> {
    let id = value.trim();
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        Err(Error::validation(
            "Id must be a non-empty string without whitespace",
        ))
    } else {
        Ok(id.to_string())
    }
}
