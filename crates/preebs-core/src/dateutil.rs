use chrono::{Datelike, Duration, NaiveDate, Weekday};

use crate::error::{Error, Result};

pub fn parse_iso_date(value: &str) -> Option<NaiveDate> {
    if value.len() != 10
        || value
            .as_bytes()
            .get(4)
            .copied()
            .is_none_or(|byte| byte != b'-')
    {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub fn to_iso(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

pub fn week_start_monday(date: NaiveDate) -> NaiveDate {
    let offset = date.weekday().num_days_from_monday() as i64;
    date - Duration::days(offset)
}

pub fn require_week_start(value: &str) -> Result<NaiveDate> {
    let date = parse_iso_date(value.trim())
        .ok_or_else(|| Error::validation("Date must use the YYYY-MM-DD format"))?;
    Ok(week_start_monday(date))
}

pub fn week_end(start: NaiveDate) -> NaiveDate {
    start + Duration::days(4)
}

pub fn week_dates(start: NaiveDate) -> [NaiveDate; 5] {
    std::array::from_fn(|index| start + Duration::days(index as i64))
}

pub fn shift_week(start: NaiveDate, weeks: i64) -> NaiveDate {
    start + Duration::days(weeks * 7)
}

/// Monday = 0 … Friday = 4. Weekends return `None`.
pub fn weekday_index(date: NaiveDate) -> Option<usize> {
    match date.weekday() {
        Weekday::Mon => Some(0),
        Weekday::Tue => Some(1),
        Weekday::Wed => Some(2),
        Weekday::Thu => Some(3),
        Weekday::Fri => Some(4),
        Weekday::Sat | Weekday::Sun => None,
    }
}

pub fn iso_week(date: NaiveDate) -> (u32, i32) {
    let week = date.iso_week();
    (week.week(), week.year())
}

pub fn format_week_range(start: NaiveDate, end: NaiveDate) -> String {
    format!("{} - {}", format_en_ca(start), format_en_ca(end))
}

fn format_en_ca(date: NaiveDate) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{} {:02}, {}",
        MONTHS[date.month0() as usize],
        date.day(),
        date.year()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        parse_iso_date(value).unwrap()
    }

    #[test]
    fn monday_week_bounds() {
        assert_eq!(to_iso(week_start_monday(date("2026-09-21"))), "2026-09-21");
        assert_eq!(to_iso(week_start_monday(date("2026-09-23"))), "2026-09-21");
        assert_eq!(to_iso(week_start_monday(date("2026-09-27"))), "2026-09-21");
        assert_eq!(to_iso(week_end(date("2026-09-21"))), "2026-09-25");
        assert!(parse_iso_date("2026-02-31").is_none());
        assert!(parse_iso_date("2026-9-21").is_none());
        assert_eq!(weekday_index(date("2026-09-23")), Some(2));
        assert_eq!(weekday_index(date("2026-09-26")), None);
    }

    #[test]
    fn iso_weeks_match_typescript() {
        assert_eq!(iso_week(date("2026-09-21")), (39, 2026));
        assert_eq!(iso_week(date("2021-01-01")), (53, 2020));
        assert_eq!(iso_week(date("2020-12-31")), (53, 2020));
        assert_eq!(iso_week(date("2024-12-30")), (1, 2025));
        assert_eq!(iso_week(date("2019-12-30")), (1, 2020));
        assert_eq!(iso_week(date("2026-01-01")), (1, 2026));
    }

    #[test]
    fn range_label() {
        assert_eq!(
            format_week_range(date("2026-09-21"), date("2026-09-25")),
            "Sep 21, 2026 - Sep 25, 2026"
        );
    }
}
