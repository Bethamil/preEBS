fn ensure_sidecar() {
    let Ok(triple) = std::env::var("TARGET") else {
        return;
    };
    let extension = if triple.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let dir = std::path::Path::new("binaries");
    let path = dir.join(format!("preebs-cli-{triple}{extension}"));
    if path.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(dir);
    let body: &[u8] = if extension.is_empty() {
        b"#!/bin/sh\necho preebs\n"
    } else {
        b"@echo preebs\r\n"
    };
    if std::fs::write(&path, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&path, perms);
            }
        }
    }
}

fn main() {
    ensure_sidecar();
    let dist = std::path::Path::new("../dist");
    if !dist.join("index.html").exists() {
        let _ = std::fs::create_dir_all(dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><html><head><title>PreEBS</title></head><body></body></html>",
        );
    }
    tauri_build::build()
}
