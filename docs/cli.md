# `preebs` CLI

The `preebs` binary reads and writes the SQLite database shared with the desktop app. It does not start a server and it does not talk to one.

```bash
cargo build --release -p preebs-cli
./target/release/preebs --help
```

## Global flags

| Flag | Meaning |
| --- | --- |
| `--json` | Pretty JSON on stdout. One JSON object. Errors are JSON on stderr. |
| `--dry-run` | Run a write inside a transaction and roll it back. Success JSON includes `"dryRun": true`. |
| `--data-dir DIR` | Directory that contains `preebs.sqlite`. Overrides `PREEBS_DATA_DIR`. |
| `--db FILE` | Database file. Overrides `PREEBS_DB_PATH` and `--data-dir`. |

Resolution order for the database path: `--db`, then `PREEBS_DB_PATH`, then `--data-dir/preebs.sqlite`, then `PREEBS_DATA_DIR/preebs.sqlite`, then the platform data directory:

- macOS: `~/Library/Application Support/PreEBS/preebs.sqlite`
- Linux: `$XDG_DATA_HOME/PreEBS/preebs.sqlite` or `~/.local/share/PreEBS/preebs.sqlite`

The CLI and the desktop app are supported on macOS and Linux.

Opening the database creates it and seeds an empty config. That seed does not bump `revision`. A committed write bumps `meta.revision` by one. A dry run leaves `revision` unchanged.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including `--help` and `--version`. |
| 1 | Unexpected I/O or database failure. |
| 2 | Validation or usage. |
| 3 | Not found. |
| 4 | Conflict: daily max, duplicate id, existing output file, existing week where that is a conflict. |
| 5 | Ambiguous name. Pass the id. |

With `--json`, a failure is one object on stderr and nothing on stdout:

```json
{
  "error": "Hours must be between 0 and 24 in increments of 0.5",
  "code": "validation"
}
```

`code` is `validation`, `not_found`, `conflict`, `ambiguous`, `io`, or `usage`.

## Hours in JSON

Stored hour values are JSON numbers, not strings. Whole hours stay integers (`8`, not `8.0`). Halves are one decimal (`7.5`). The week **file** written by `export` is different: those hours are strings with a comma decimal (`"8"`, `"7,5"`, `"0,5"`), matching the browser extensions.

`--hours` and `--max-hours` accept `7.5` and `7,5`. `--max-hours` is five Monday–Friday values separated by commas (`8,8,8,8,8` or `7.5,8,8,8,8`), whitespace (`7,5 8 8 8 8`), or semicolons when a value itself uses a decimal comma (`7,5;8;8;8;8`).

## Names and ids

An id always wins. A name (or a project label) is accepted only when exactly one entity matches, compared case-insensitively after trimming and collapsing internal whitespace. Zero matches is not found (exit 3). Several matches is ambiguous (exit 5). `hour-type edit` and `hour-type rm` may omit `--project` and `--task` only when the id is unique. `default-straight-time` usually is not, because every task that uses the historical default shares that id.

## Commands and `--json` shapes

Successful `--json` output is pretty-printed with a trailing newline. `--dry-run` adds `"dryRun": true` on the object. Reads ignore `--dry-run`.

### `config show`

```json
{ "config": { "userId": "local-user", "maxHoursPerDay": [8, 8, 8, 8, 8], "defaultHourTypeName": "Straight Time", "projects": [], "updatedAt": "..." } }
```

`label` is omitted when a project or task has none. `archived` is omitted when false. `projects[].tasks[].hourTypes` has exactly one `{ "id", "name" }` after save. The parser still accepts a longer list; normalize collapses it.

### `config set`

Requires `--max-hours` and/or `--default-hour-type`. Same `{ "config" }` object. Changing the default hour type name does not rewrite existing tasks. New tasks that omit `--hour-type` receive that name. If the name matches `Straight Time` case-insensitively, the id is `default-straight-time`. Otherwise the id is new. A config file that already contains other hour-type names keeps those names.

### `config export [--out FILE]`

Default path: `./preebs-config-YYYY-MM-DD.json`. Refuses to overwrite (exit 4).

Stdout:

```json
{ "output": "/absolute/preebs-config-2026-09-21.json", "exportedAt": "2026-09-21T12:00:00.000Z" }
```

The file itself is `preebs-config` version 1, pretty-printed with a trailing newline:

```json
{
  "type": "preebs-config",
  "version": 1,
  "exportedAt": "2026-09-21T12:00:00.000Z",
  "config": {}
}
```

Files written by the old app omit `defaultHourTypeName`, task `label`, and `archived`. Import treats a missing default as `Straight Time`, a missing task label as none, and a missing `archived` as false. Unknown fields are ignored. `type` must be `preebs-config` and `version` must be `1`. Empty project, task, and hour-type names are dropped. Several hour types on one task collapse to one: the first name that is not `Straight Time`, otherwise the first. Week rows for that task are rewritten onto the surviving hour type and merged (hours added and clamped, first note wins). The export shape stays `tasks[].hourTypes[]`.

### `config import <file>`

Replaces config. Weeks stay. Stdout is `{ "config" }`.

### `project list`

```json
{ "projects": [] }
```

### `project add|edit|rm`

```json
{ "project": { "id": "...", "name": "...", "tasks": [] } }
```

`project add --name NAME [--label LABEL] [--id ID]`. `--name` is the EBS project name. `--label` is the optional display name. `--label ""` clears on edit. Omitting `--label` leaves it. `--archive` and `--unarchive` hide or show the project. `project rm` does not delete week rows that already use the project.

### `task list --project PROJECT`

```json
{ "projectId": "...", "tasks": [] }
```

### `task add|edit|rm`

```json
{ "task": { "id": "...", "name": "...", "hourTypes": [] } }
```

`task add --name` is the exact EBS task name. `--label` is optional and shown in the app instead; export keeps `--name`. `--label ""` clears it. With no `--hour-type`, the default hour type is attached. Repeating `--hour-type` still stores one, using the collapse rule. A task id is unique across the whole config. A task label counts as a name for `book` and `task edit`. `hour-type add` and `hour-type rm` exit 2. Rename the only hour type with `task edit --hour-type` or `hour-type edit` (the id is kept).

### `hour-type list --project PROJECT --task TASK`

```json
{ "projectId": "...", "taskId": "...", "hourTypes": [] }
```

### `hour-type add|edit|rm`

```json
{ "hourType": { "id": "...", "name": "..." } }
```

### `weeks [--query TEXT]`

Newest Monday first. The query matches week dates, project names, task names, and hour type names.

```json
{
  "weeks": [
    {
      "weekStartDate": "2026-09-21",
      "weekEndDate": "2026-09-25",
      "totalHours": 31,
      "requiredHours": 40,
      "hoursDelta": -9,
      "hoursStatus": "under",
      "updatedAt": "..."
    }
  ]
}
```

`hoursStatus` is `under`, `match`, or `over`. The comparison is exact on half-hour steps. `requiredHours` is the sum of `maxHoursPerDay`.

### `week show --date YYYY-MM-DD`

Any date in the week selects that week. A missing week is still exit 0, with an empty document and `"exists": false`.

```json
{
  "config": {},
  "week": {
    "id": "local-user:2026-09-21",
    "userId": "local-user",
    "weekStartDate": "2026-09-21",
    "weekEndDate": "2026-09-25",
    "customProjects": [],
    "rows": [],
    "createdAt": "...",
    "updatedAt": "..."
  },
  "exists": false,
  "recentCombos": []
}
```

A row is `{ "id", "projectId", "projectName", "taskId", "taskName", "hourTypeId", "hourTypeName", "hours": [0, 0, 0, 0, 0] }`. `note` is omitted when empty. `hours` is Monday through Friday. `recentCombos` holds up to 8 combos, newest week first, first time a combo appears.

### `week copy-previous --date YYYY-MM-DD`

Replaces the target week with the previous week's rows and custom projects. Row ids are new. Stdout is `{ "week" }`. Exit 3 when the previous week does not exist.

### `week rm --date YYYY-MM-DD`

```json
{ "deleted": true, "weekStart": "2026-09-21" }
```

### `week custom-project add|rm`

```json
{ "week": {} }
```

`add --date YYYY-MM-DD --name NAME [--id ID]`. `rm --date YYYY-MM-DD <id>` also accepts a unique name and deletes rows that used that custom project.

### `book`

Sets one Monday–Friday cell. It does not add. The same command twice leaves the same value.

```bash
preebs book --date 2026-09-25 --project PROJECT --task TASK --hours 7,5
preebs book --date 2026-09-25 --project PROJECT --task TASK --hour-type HOUR --hours 4 --note "Ship the grid"
preebs book --date 2026-09-25 --project PROJECT --task TASK --hours 4 --note ""
```

Omit `--hour-type` only when the task has exactly one hour type. Omit `--note` to keep the row note. `--note ""` clears it. The note belongs to the whole row, not one day.

A booking that would put the day over `maxHoursPerDay` is rejected and writes nothing, including the note (exit 4). Weekend dates are exit 2.

```json
{
  "booking": {
    "date": "2026-09-25",
    "dayIndex": 4,
    "previousHours": 0,
    "hours": 7.5,
    "dayTotal": 7.5,
    "maxHoursForDay": 8,
    "week": {}
  }
}
```

`dayIndex` is 0 for Monday through 4 for Friday.

### `export --date YYYY-MM-DD [--output FILE]`

Default path: `./preebs-YYYY-MM-DD.json` using the Monday of that week. Refuses to overwrite.

```json
{ "output": "/absolute/preebs-2026-09-21.json", "weekStart": "2026-09-21" }
```

The file is the extension document, not this envelope. It is pretty JSON with two-space indent and a trailing newline. It always has five days. Zero cells are omitted. Notes are omitted. Order follows config order of project, then task, then hour type. If two hour types share an id, the later one in that index wins, which matches the TypeScript exporter (Overtime can sort before Straight Time when both use ids that collide). The Chrome and Firefox extensions are unchanged.

### `migrate [--from FILE]`

Without `--from`, searches:

- `~/Library/Application Support/PreEBS/preebs-db.json`
- `~/Library/Application Support/preebs/preebs-db.json`
- `~/.preebs-desktop/preebs-db.json`
- `./data/preebs-db.json`
- the PreEBS data directory

Config in the file replaces SQLite config. Weeks in the file are upserted. Weeks that exist only in SQLite stay. The JSON file is not deleted. Running it again is safe.

```json
{
  "source": "/absolute/preebs-db.json",
  "users": 1,
  "projects": 2,
  "tasks": 4,
  "hourTypes": 5,
  "weeks": 1,
  "rows": 5
}
```
