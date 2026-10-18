# PreEBS Rust rebuild

This document is the spec for the Rust port. It was written from the previous TypeScript app before any Rust code. That Next.js and Electron tree is no longer in the repository; it remains in git history. `chrome-extension/` and `firefox-extension/` stay where they are. They keep consuming the week export JSON unchanged.

## Why the UI is Svelte

The desktop UI is Svelte 5 (compiled by Vite) inside a Tauri v2 shell. Domain logic stays in `preebs-core`. The webview is a view over Tauri commands.

Leptos was the other serious option (one language, no JS toolchain). It loses here for three practical reasons:

- The week grid, command palette, focus management, and system theme are ordinary DOM work. Svelte does that with little code and no virtual-DOM tax. A Leptos grid of 150 cells (3 projects × 10 tasks × 5 days) is fine, but the keyboard and accessibility behavior is slower to get right.
- The shipping bundle has to stay under 20 MB. Tauri already uses the system webview, so the Rust binary plus a few dozen kilobytes of Svelte is the whole app. A WASM UI would add a second compiled artifact and a second layout engine to debug.
- Tauri’s Svelte/Vite path is the one its tooling expects (`beforeBuildCommand`, dev server on port 1420). That keeps CI boring on macOS and Linux.

No Next.js, no React, no component library. CSS is plain, using the existing PreEBS palette.

## Workspace

```
Cargo.toml                          workspace root
crates/preebs-core/                 domain, export, SQLite
crates/preebs-cli/                  binary `preebs` (clap)
crates/preebs-app/                  Svelte UI
crates/preebs-app/src-tauri/        Tauri v2 shell, workspace member
docs/rust-plan.md                   this file
docs/cli.md                         stable JSON schemas
chrome-extension/                   unchanged
firefox-extension/                  unchanged
```

`crates/preebs-app/src-tauri` is the Cargo package `preebs-app`. Nesting it is the Tauri v2 layout (`package.json` beside `src-tauri/`) so `tauri build` works without a custom project path. Both binaries link `preebs-core` and open the same database file. The toolchain is Rust 1.90, which is what Tauri 2.12 requires.

Release profile: size-oriented (`opt-level = "s"`, thin LTO, stripped) so the `.app` stays under 20 MB. SQLite is bundled inside the binary (`rusqlite` `bundled`) so macOS does not need a system SQLite. Linux and macOS are the supported platforms.

## Storage

SQLite in WAL mode, `busy_timeout` 5s, foreign keys on.

| Platform | Directory | File |
| --- | --- | --- |
| macOS | `~/Library/Application Support/PreEBS/` | `preebs.sqlite` |
| Linux | `$XDG_DATA_HOME/PreEBS/` or `~/.local/share/PreEBS/` | `preebs.sqlite` |

Overrides, matching the old env names:

- `PREEBS_DB_PATH` or `--db` is the file.
- `PREEBS_DATA_DIR` or `--data-dir` is the directory (file name stays `preebs.sqlite`).

The CLI never talks HTTP. It opens the database itself. The app polls a `meta.revision` counter (bumped on every committed write) about once a second and on focus, and reloads when it changes. WAL lets the app read while the CLI writes.

The old Electron files are left in place and are not the live database:

- Packaged app: `~/Library/Application Support/PreEBS/preebs-db.json` (and the lowercase `preebs` folder the old CLI probed)
- Dev desktop: `~/.preebs-desktop/preebs-db.json`
- Repo: `data/preebs-db.json`
- Linux equivalent under the `PreEBS` data dir

`preebs migrate --from <file>` imports one JSON database. Without `--from`, the command tries those paths and uses the first that exists. `--dry-run` reports counts and writes nothing. Re-running is safe: config is replaced by the source config, weeks present in the file are upserted by id, weeks that exist only in SQLite are left alone. The JSON file is never deleted.

## Domain model

Single local user. `userId` stays `"local-user"`, `name` stays `"Local User"`.

### Config

```
UserConfig
  userId: string
  maxHoursPerDay: Hours[5]          # Mon..Fri
  defaultHourTypeName: string       # NEW. Default "Straight Time"
  projects: Project[]
  updatedAt: ISO-8601

Project
  id, name, label?

Task
  id, name, hourTypes: HourType[]

HourType
  id, name
```

`Hours` is a half-hour count from 0 to 24 inclusive (`0, 0.5, …, 24`). JSON integers stay integers (`8`, not `8.0`). Halves serialize as `7.5`. Display and the EBS export use a comma (`"7,5"`), ported from `formatHours`.

Constants kept compatible with stored data:

- `DEFAULT_HOUR_TYPE_ID = "default-straight-time"`
- `DEFAULT_HOUR_TYPE_NAME = "Straight Time"`
- `DEFAULT_MAX_HOURS_PER_DAY = 8`
- `WEEKDAY_COUNT = 5`

New tasks with no hour types get one hour type named `defaultHourTypeName`. When that name equals `Straight Time` (case-insensitive, whitespace-collapsed), the id is `default-straight-time`. Otherwise the id is a new UUID. Changing the default later does not rewrite existing tasks. Names already stored on tasks, including older defaults, are user data and are left as imported.

Names are `trim` + internal whitespace collapsed to a single space (`safeTrim`). Empty names are dropped. Empty labels and notes are stored as absent, not `""`.

Ids are stable UUIDs unless the caller passes `--id`. Project ids are unique. Task ids are unique across the config (the old week normalizer keyed tasks globally). Hour-type ids are unique per task and are **not** globally unique: many tasks share `default-straight-time`.

`maxHoursPerDay` is always length 5. Missing or non-finite entries become 8, then the value is snapped with the same `clampHours` rule as the TypeScript store (round to nearest 0.5, clamp to 0..=24).

### Weeks

A week is Monday 00:00 through Friday. Any date inside the week addresses that week. Sunday belongs to the previous Monday. Week identity is `local-user:{yyyy-mm-dd}` of the Monday. `weekEndDate` is that Friday.

```
WeekDocument
  id, userId, weekStartDate, weekEndDate
  customProjects: { id, name }[]
  rows: StoredWeekRow[]
  createdAt, updatedAt

StoredWeekRow
  id
  projectId, projectName
  taskId, taskName
  hourTypeId, hourTypeName
  hours: Hours[5]
  note?
```

A row is the unique key `projectId + taskId + hourTypeId` inside one week. Saving a week that contains duplicates merges them: hours are added per day and clamped, the first note wins, the first id wins. Order of first occurrence is kept.

Custom projects are week-local names that are not in config. They are how the week screen records something that is not an EBS project yet. `book` does not create them; it only accepts configured projects.

Row names are denormalized. On save, a combo that still exists in config is rewritten to the current config names. A combo that does not is kept as a custom row (project name from the row, the custom-project list, or `"Custom Project"`). That is the `normalizeWeekRows` behavior.

### Recent combos

`getRecentCombos` walks weeks by `updatedAt` descending, then rows in stored order, and returns the first 8 distinct `project+task+hourType` keys.

### Week summary

```
totalHours, requiredHours (sum of maxHoursPerDay)
hoursDelta = total - required
hoursStatus = "under" | "match" | "over"     # exact equality
```

List order is `weekStartDate` descending. Search (`--query`) matches week start, week end, project name, task name, or hour-type name, case-insensitive. Same rule as `includeWeekInSearch`.

## Rules (ported 1:1)

Booking **sets** the cell. It does not add. The same command twice is a no-op aside from `updatedAt` when the note is also resent.

Rejected bookings write nothing, including the case where the daily total would exceed `maxHoursPerDay` for that weekday. Comparison uses a `1e-9` tolerance, matching the TypeScript check.

| Rule | Result |
| --- | --- |
| Date not `YYYY-MM-DD` or not a real calendar date | validation error |
| Saturday or Sunday | validation error, Monday–Friday only |
| Hours not finite, or outside 0..=24, or not a multiple of 0.5 (tolerance `1e-9`) | validation error |
| `"7,5"` and `"7.5"` | both mean 7.5 |
| Unknown project id | not found |
| Task id not on that project | not found |
| Hour type omitted and the task has exactly one | use that hour type |
| Hour type omitted and the task has zero or more than one | validation error |
| Hour type not on that task | not found |
| Day total would exceed `maxHoursPerDay[day]` | conflict, no write |
| `--hours 0` | clears that day; the row stays |
| `--note` omitted | existing note unchanged |
| `--note ""` | clears the note |
| Note | belongs to the whole row, not one day |

`saveWeek` (the grid) does **not** enforce the daily maximum. The UI warns. Only `book` rejects. That split is intentional and matches the TypeScript API.

Copy-previous copies the previous Monday’s rows (new row ids) and custom projects onto the target week, replacing that week. Created time is kept if the target already existed. Missing previous week is not found.

Delete of a missing week is not found.

Config import replaces the whole config and does not touch weeks. Wrong `type` or `version` is rejected. The parser is the one in `lib/config-transfer.ts`:

- `type` must be `"preebs-config"`, `version` must be the number `1`
- `userId` is forced to `local-user`
- projects, tasks, and hour types that are not objects or have an empty name are skipped
- `label` is kept only when non-empty
- `maxHoursPerDay` keeps finite numbers (numeric strings allowed) and drops the rest
- after parsing, values are clamped and padded to five days the same way as `normalizeConfig`

Week export (`lib/export.ts`), byte-stable for the extensions:

- Always five days, Monday through Friday, even when empty
- Shape `day → projects → tasks → hour types`
- Every node has id and name
- Hours are strings from `formatHours` (`"8"`, `"7,5"`, `"0"`)
- A cell of 0 is omitted; a day of zeros has `"projects": []` and `"totals": { "hours": "0" }`
- Sort is config order of project, then task, then hour type. Ids missing from config sort last. The sort is stable.
- `maxHoursPerDay` on the export is five strings, not numbers
- Notes are not part of the export
- Pretty-printed with two-space indent and a trailing newline, which is what `scripts/preebs.mjs` writes
- Never overwrite an existing output file

Default export path: `./preebs-{monday}.json`. Config export default: `./preebs-config-{yyyy-mm-dd}.json`.

## Intentional differences from TypeScript

These are called out so parity review does not treat them as accidents.

1. **Hour types are not collapsed.** `normalizeConfig` and the config screen kept a single hour type per task, preferring a name other than the historical default. The new CLI has `hour-type add|edit|rm`, and booking already distinguished “exactly one” from “several”, so the Rust core stores every hour type. Empty lists still receive the default hour type. Migration does not invent or drop hour types that are present in the JSON.
2. **`defaultHourTypeName` is new** on `UserConfig`. Config files from the TypeScript app omit it and import as `Straight Time`. Exported config (still `type: "preebs-config"`, `version: 1`) includes the field. The old parser ignored unknown fields, so an old build would still read projects and max hours. Hour-type names already in a file are kept as user data.
3. **Reads do not bump `updatedAt`.** `getConfig` ran `normalizeConfig`, which set `updatedAt` to now in the response without saving. Rust returns the stored timestamp.
4. **`week show` adds `exists`.** The HTTP API always returned a synthetic empty week, so a missing week and an empty saved week looked the same. JSON now includes `"exists": false` plus that same empty document.
5. **Names are accepted as well as ids**, case-insensitive, only when one entity matches. Project labels count as names. Ambiguous input is an error (exit 5), never a guess. Ids win over names.
6. **Storage is SQLite**, not `preebs-db.json`, and there is no HTTP server and no Electron process.
7. **The last hour type on a task cannot be removed.** The old normalizer would have put the default back on the next save anyway.
8. **Migration keeps SQLite-only weeks** instead of making the database an exact mirror of one JSON file. Config itself is replaced.

## CLI

Binary name: `preebs`. Non-interactive. No prompts. Global flags:

- `--json` stable JSON on stdout. Errors are a single JSON object on stderr: `{"error":"...","code":"validation|not_found|conflict|ambiguous|io|usage"}`.
- `--dry-run` on any write: do the work in a transaction and roll it back. Success JSON includes `"dryRun": true`.
- `--data-dir`, `--db`

Exit codes: `0` ok, `1` unexpected, `2` validation or usage, `3` not found, `4` conflict (daily max, file exists, duplicate id, week exists where relevant), `5` ambiguous name.

Help text on every command states the rule an agent would otherwise have to read this file for. Schemas live in `docs/cli.md`.

```
preebs config show
preebs config set (--max-hours LIST | --default-hour-type NAME)
preebs config export [--out FILE]
preebs config import <file> [--dry-run]

preebs project list
preebs project add --name NAME [--label LABEL] [--id ID]
preebs project edit <id> [--name NAME] [--label LABEL]
preebs project rm <id>

preebs task list --project PROJECT
preebs task add --project PROJECT --name NAME [--hour-type NAME ...] [--id ID]
preebs task edit <id> [--name NAME]
preebs task rm <id>

preebs hour-type list --project PROJECT --task TASK
preebs hour-type add --project PROJECT --task TASK --name NAME [--id ID]
preebs hour-type edit <id> [--name NAME] [--project PROJECT --task TASK]
preebs hour-type rm <id> [--project PROJECT --task TASK]

preebs weeks [--query TEXT]
preebs week show --date YYYY-MM-DD
preebs week copy-previous --date YYYY-MM-DD
preebs week rm --date YYYY-MM-DD
preebs week custom-project add --date YYYY-MM-DD --name NAME [--id ID]
preebs week custom-project rm --date YYYY-MM-DD <id>

preebs book --date YYYY-MM-DD --project P --task T [--hour-type H] --hours N [--note TEXT]
preebs export --date YYYY-MM-DD [--output FILE]
preebs migrate [--from FILE] [--dry-run]
```

`--max-hours` is five values. Separator is a comma (`8,8,8,8,8` or `7.5,8,8,8,8`), whitespace (`7,5 8 8 8 8`), or semicolons when a value itself uses a decimal comma (`7,5;8;8;8;8`).

`--label ""` clears a label. Omitting `--label` leaves it. Same pattern for notes.

`hour-type edit|rm` may omit `--project` and `--task` only when the id matches a single row. `default-straight-time` usually will not.

## Desktop app

Tauri v2 commands call `preebs-core`. There is no embedded server.

Screens:

- **Week** (home). Project groups, one row per combo, five day cells, totals per day, per row, per project, and per week. Max-hour warnings on the day and the project. Autosave. Copy previous week. Custom projects. Add the next missing configured combo. Arrow keys move between cells; Tab follows DOM order. Enter moves down.
- **Weeks.** Search, status (under / match / over), open, delete, export.
- **Config.** Projects, tasks, hour types, default hour type name, max hours per day. Reorder within a project. Search.
- **Export.** Preview of the extension JSON, save without overwriting, copy. Config import/export lives on the config screen and is also a command-palette action.

UX bar:

- Command palette on Cmd/Ctrl-K, and a native menu bar with the same actions.
- No horizontal scrolling at the 980px minimum. Day columns are fixed width; the name column flexes.
- Light and dark follow the system, with an explicit override.
- Focus rings, associated labels, contrast from the existing palette (accent green on near-white / near-black, warning and danger tokens kept).
- macOS `.app` and `.dmg` are produced unsigned but with a real bundle id `com.preebs.desktop` and `LSMinimumSystemVersion` 11.0, so a signing identity can be applied without a rebuild of the UI. CI also builds a Linux deb. Windows installers are not built.

Shortcuts: Cmd/Ctrl-K palette, Cmd/Ctrl-1/2/3/4 for Week/Weeks/Config/Export, Cmd/Ctrl-Left/Right previous/next week, Cmd/Ctrl-E export, Cmd/Ctrl-Shift-C copy previous week.

## Parity checklist

Export and config transfer are checked against golden files produced by running the TypeScript functions (`lib/export.ts`, `lib/config-transfer.ts`, `lib/utils.ts`) via Node, not against a hand-written expectation. Fixtures live in `crates/preebs-core/tests/fixtures/`.

- [x] Hours parse: `7.5`, `7,5`, `8`, `0`, `24` accepted; `7.25`, `-1`, `24.5`, blank rejected
- [x] `formatHours` matches TS: `8` → `"8"`, `7.5` → `"7,5"`, `0.5` → `"0,5"`
- [x] `clampHours` matches TS rounding for save/config paths
- [x] Monday week start, Sunday rolls back, invalid calendar dates fail
- [x] ISO week number matches `getIsoWeekNumber`
- [x] Book sets, is idempotent, rejects weekend, rejects over-max with zero writes
- [x] Hour type optional only when the task has exactly one
- [x] Task must belong to the project; hour type must belong to the task
- [x] Duplicate week rows merge by summing clamped hours
- [x] Copy previous replaces the target and gives rows new ids
- [x] Recent combos: 8, newest week first, first-seen order
- [x] Week search and summary status
- [x] Golden week export, exact pretty JSON
- [x] Config export/import roundtrip, including rejection of bad type/version and skipping empty names
- [x] `defaultHourTypeName` roundtrips; missing field defaults to `Straight Time`; new tasks receive `default-straight-time` when the name matches
- [x] Multiple hour types survive save (the TS collapse is gone)
- [x] Migrate is idempotent and `--dry-run` does not create a database write
- [x] Export refuses to overwrite
- [x] CLI `--json` error shape and exit codes
- [x] Ambiguous name vs unique name vs id
- [x] App and CLI share one SQLite file; a CLI write changes `revision`

## Tests and CI

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace` (unit tests in core, golden/export/config/migrate integration tests, CLI tests via `assert_cmd`)
- GitHub Actions on `ubuntu-latest` and `macos-latest`: fmt, clippy, test, then a Tauri bundle (deb / app+dmg). Linux image installs WebKitGTK 4.1. A tag `vX.Y.Z` publishes a GitHub Release; see `docs/releasing.md`.

## Out of scope

- Rewriting the Chrome or Firefox extensions
- Keeping the Next.js HTTP API running
- Multi-user
- Signing the macOS build with a real Apple certificate (the bundle is ready for it; CI does not hold a certificate)
