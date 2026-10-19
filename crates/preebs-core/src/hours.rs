use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{Error, Result};

/// A single cell: 0 through 24 hours in steps of 0.5.
///
/// Stored as half-hour steps so 7.5 and 8 cannot drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Hours(i32);

/// A sum of cells. Week and day totals may exceed 24, and a delta may be negative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct HourSum(i32);

const MAX_HALVES: i32 = 48;
const HOURS_ERROR: &str = "Hours must be between 0 and 24 in increments of 0.5";

impl Hours {
    pub const ZERO: Self = Self(0);
    pub const EIGHT: Self = Self(16);

    pub fn halves(self) -> i32 {
        self.0
    }

    pub fn saturating_add(self, other: Self) -> Self {
        Self((self.0 + other.0).clamp(0, MAX_HALVES))
    }

    pub fn from_halves(value: i32) -> Result<Self> {
        if (0..=MAX_HALVES).contains(&value) {
            Ok(Self(value))
        } else {
            Err(Error::validation(HOURS_ERROR))
        }
    }

    /// Accept a value only when it is already on a half-hour step, matching `bookHours`.
    pub fn from_f64_exact(value: f64) -> Result<Self> {
        if !value.is_finite() || !(0.0..=24.0).contains(&value) {
            return Err(Error::validation(HOURS_ERROR));
        }
        let steps = value / 0.5;
        let rounded = steps.round();
        if (steps - rounded).abs() > 1e-9 {
            return Err(Error::validation(HOURS_ERROR));
        }
        let halves = rounded as i32;
        if !(0..=MAX_HALVES).contains(&halves) {
            return Err(Error::validation(HOURS_ERROR));
        }
        Ok(Self(halves))
    }

    /// `clampHours` from `lib/utils.ts`: snap to the nearest 0.5 and cap at 0..=24.
    pub fn clamp_f64(value: f64) -> Self {
        if !value.is_finite() || value <= 0.0 {
            return Self::ZERO;
        }
        let steps = (value / 0.5).round().clamp(0.0, MAX_HALVES as f64);
        Self(steps as i32)
    }

    /// Parse `7.5` or `7,5`.
    pub fn parse_exact(input: &str) -> Result<Self> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(Error::validation(HOURS_ERROR));
        }
        let normalized = trimmed.replace(',', ".");
        let value: f64 = normalized
            .parse()
            .map_err(|_| Error::validation(HOURS_ERROR))?;
        Self::from_f64_exact(value)
    }

    pub fn format_export(self) -> String {
        format_halves(self.0)
    }

    /// JavaScript number text: `8`, `7.5`.
    pub fn to_js_number(self) -> String {
        js_number(self.0)
    }
}

impl HourSum {
    pub const ZERO: Self = Self(0);

    pub fn from_halves(value: i32) -> Self {
        Self(value)
    }

    pub fn halves(self) -> i32 {
        self.0
    }

    pub fn from_hours(hours: Hours) -> Self {
        Self(hours.0)
    }

    pub fn saturating_from_hours_slice(values: &[Hours]) -> Self {
        Self(values.iter().map(|hours| hours.0).sum())
    }

    pub fn checked_add_hours(self, hours: Hours) -> Self {
        Self(self.0 + hours.0)
    }

    pub fn format_export(self) -> String {
        format_halves(self.0)
    }

    pub fn to_js_number(self) -> String {
        js_number(self.0)
    }
}

pub fn format_halves(halves: i32) -> String {
    let sign = if halves < 0 { "-" } else { "" };
    let abs = halves.abs();
    if abs % 2 == 0 {
        format!("{sign}{}", abs / 2)
    } else {
        format!("{sign}{},5", abs / 2)
    }
}

fn js_number(halves: i32) -> String {
    let sign = if halves < 0 { "-" } else { "" };
    let abs = halves.abs();
    if abs % 2 == 0 {
        format!("{sign}{}", abs / 2)
    } else {
        format!("{sign}{}.5", abs / 2)
    }
}

impl Serialize for Hours {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serialize_halves(self.0, serializer)
    }
}

impl Serialize for HourSum {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serialize_halves(self.0, serializer)
    }
}

fn serialize_halves<S: Serializer>(
    halves: i32,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    if halves % 2 == 0 {
        serializer.serialize_i64(i64::from(halves / 2))
    } else {
        serializer.serialize_f64(f64::from(halves) / 2.0)
    }
}

impl<'de> Deserialize<'de> for HourSum {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let halves = deserializer.deserialize_any(HalvesVisitor)?;
        Ok(Self(halves))
    }
}

struct HalvesVisitor;

impl serde::de::Visitor<'_> for HalvesVisitor {
    type Value = i32;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a half-hour quantity")
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> std::result::Result<i32, E> {
        halves_from_f64(value as f64).map_err(E::custom)
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> std::result::Result<i32, E> {
        halves_from_f64(value as f64).map_err(E::custom)
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> std::result::Result<i32, E> {
        halves_from_f64(value).map_err(E::custom)
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> std::result::Result<i32, E> {
        let normalized = value.trim().replace(',', ".");
        let parsed: f64 = normalized.parse().map_err(E::custom)?;
        halves_from_f64(parsed).map_err(E::custom)
    }
}

fn halves_from_f64(value: f64) -> std::result::Result<i32, String> {
    if !value.is_finite() {
        return Err(HOURS_ERROR.to_string());
    }
    let steps = value / 0.5;
    let rounded = steps.round();
    if (steps - rounded).abs() > 1e-9 || rounded.abs() > i32::MAX as f64 {
        return Err(HOURS_ERROR.to_string());
    }
    Ok(rounded as i32)
}

impl<'de> Deserialize<'de> for Hours {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(HoursVisitor)
    }
}

struct HoursVisitor;

impl serde::de::Visitor<'_> for HoursVisitor {
    type Value = Hours;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("an hour value (number or decimal string)")
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> std::result::Result<Hours, E> {
        Hours::from_f64_exact(value as f64).map_err(E::custom)
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> std::result::Result<Hours, E> {
        Hours::from_f64_exact(value as f64).map_err(E::custom)
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> std::result::Result<Hours, E> {
        Hours::from_f64_exact(value).map_err(E::custom)
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> std::result::Result<Hours, E> {
        Hours::parse_exact(value).map_err(E::custom)
    }
}

/// Five Mon–Fri maxima. Accepts `8,8,8,8,8`, `7.5,8,8,8,8`, `7,5 8 8 8 8`, or `7,5;8;8;8;8`.
pub fn parse_max_hours_list(input: &str) -> Result<[Hours; 5]> {
    let trimmed = input.trim().trim_start_matches('[').trim_end_matches(']');
    let parts: Vec<&str> = if trimmed.contains(';') {
        trimmed.split(';').collect()
    } else if trimmed.split_whitespace().count() == 5 {
        trimmed.split_whitespace().collect()
    } else {
        trimmed.split(',').collect()
    };
    if parts.len() != 5 {
        return Err(Error::validation(
            "--max-hours needs five Mon-Fri values, for example 8,8,8,8,8 or 7.5,8,8,8,8 or 7,5;8;8;8;8",
        ));
    }
    let mut hours = [Hours::ZERO; 5];
    for (index, part) in parts.iter().enumerate() {
        hours[index] = Hours::parse_exact(part)?;
    }
    Ok(hours)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_comma_and_dot() {
        assert_eq!(Hours::parse_exact("7,5").unwrap().halves(), 15);
        assert_eq!(Hours::parse_exact("7.5").unwrap().halves(), 15);
        assert_eq!(Hours::parse_exact("8").unwrap().halves(), 16);
        assert_eq!(Hours::parse_exact("0").unwrap(), Hours::ZERO);
        assert_eq!(Hours::parse_exact("24").unwrap().halves(), 48);
        assert_eq!(Hours::parse_exact("0,5").unwrap().format_export(), "0,5");
    }

    #[test]
    fn rejects_off_step_values() {
        for value in ["7.25", "7,25", "-1", "24.5", "", "nope", "24,5"] {
            assert!(Hours::parse_exact(value).is_err(), "{value}");
        }
    }

    #[test]
    fn format_matches_typescript() {
        assert_eq!(Hours::from_halves(16).unwrap().format_export(), "8");
        assert_eq!(Hours::from_halves(15).unwrap().format_export(), "7,5");
        assert_eq!(Hours::from_halves(1).unwrap().format_export(), "0,5");
        assert_eq!(Hours::from_halves(21).unwrap().format_export(), "10,5");
        assert_eq!(Hours::ZERO.format_export(), "0");
    }

    #[test]
    fn clamp_matches_typescript() {
        assert_eq!(Hours::clamp_f64(7.4).halves(), 15);
        assert_eq!(Hours::clamp_f64(7.2).halves(), 14);
        assert_eq!(Hours::clamp_f64(0.3).halves(), 1);
        assert_eq!(Hours::clamp_f64(24.2).halves(), 48);
        assert_eq!(Hours::clamp_f64(100.0).halves(), 48);
        assert_eq!(Hours::clamp_f64(-3.0), Hours::ZERO);
        assert_eq!(Hours::clamp_f64(f64::NAN), Hours::ZERO);
        assert_eq!(Hours::clamp_f64(7.25).format_export(), "7,5");
    }

    #[test]
    fn max_hours_list_separators() {
        assert_eq!(
            parse_max_hours_list("8,8,8,8,8").unwrap(),
            [Hours::EIGHT; 5]
        );
        assert_eq!(
            parse_max_hours_list("7.5,8,8,8,8").unwrap()[0].format_export(),
            "7,5"
        );
        assert_eq!(
            parse_max_hours_list("7,5;8;8;8;8").unwrap()[0].format_export(),
            "7,5"
        );
        assert_eq!(
            parse_max_hours_list("7,5 8 8 8 8").unwrap()[0].format_export(),
            "7,5"
        );
    }

    #[test]
    fn json_numbers_stay_integers_when_whole() {
        let value = serde_json::to_value(Hours::EIGHT).unwrap();
        assert_eq!(value, serde_json::json!(8));
        let half = serde_json::to_value(Hours::from_halves(15).unwrap()).unwrap();
        assert_eq!(half, serde_json::json!(7.5));
        let delta = HourSum::from_halves(-3);
        assert_eq!(delta.to_js_number(), "-1.5");
        assert_eq!(delta.format_export(), "-1,5");
    }
}
