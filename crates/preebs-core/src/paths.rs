use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub const DB_FILE_NAME: &str = "preebs.sqlite";
pub const LEGACY_DB_FILE_NAME: &str = "preebs-db.json";

pub fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PreEBS")
}

pub fn resolve_db_path(db_flag: Option<&Path>, data_dir_flag: Option<&Path>) -> PathBuf {
    if let Some(path) = db_flag {
        return path.to_path_buf();
    }
    if let Some(path) = env_nonempty("PREEBS_DB_PATH") {
        return PathBuf::from(path);
    }
    if let Some(dir) = data_dir_flag {
        return dir.join(DB_FILE_NAME);
    }
    if let Some(dir) = env_nonempty("PREEBS_DATA_DIR") {
        return PathBuf::from(dir).join(DB_FILE_NAME);
    }
    default_data_dir().join(DB_FILE_NAME)
}

fn env_nonempty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Create the file only when it does not exist. Matches the old CLI `wx` flag.
pub fn write_new_file(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(contents.as_bytes())?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(Error::conflict(
            format!("Output file already exists: {}", path.display()),
        )),
        Err(error) => Err(Error::Io(error)),
    }
}

pub fn absolute_path(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}
