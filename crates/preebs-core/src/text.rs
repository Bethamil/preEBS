/// Trim and collapse internal whitespace the same way as `safeTrim` in `lib/utils.ts`.
pub fn safe_trim(value: &str) -> String {
    let mut out = String::new();
    let mut pending_space = false;
    for c in value.trim().chars() {
        if c.is_whitespace() {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        }
    }
    out
}

pub fn names_equal(left: &str, right: &str) -> bool {
    safe_trim(left).to_lowercase() == safe_trim(right).to_lowercase()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::safe_trim;

    #[test]
    fn collapses_whitespace() {
        assert_eq!(safe_trim("  Alpha   One \n"), "Alpha One");
        assert_eq!(safe_trim("   "), "");
        assert_eq!(safe_trim(" Straight "), "Straight");
    }
}
