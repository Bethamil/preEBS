fn main() {
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
