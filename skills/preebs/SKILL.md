---
name: preebs
description: Book, inspect, and export work hours in PreEBS through its CLI. Use this skill whenever a user asks an agent to register, change, check, list, or export timesheet hours, projects, tasks, weekdays, or PreEBS weeks, including preparing JSON for the EBS browser extension.
compatibility: Requires the `preebs` binary on PATH. No server. The desktop app does not need to be running.
---

# PreEBS

Use the `preebs` CLI. It writes the same SQLite database as the desktop app. Do not edit the database file, do not call HTTP, and do not start a server.

If `preebs` is not on `PATH` inside this repository, use `cargo run -p preebs-cli --`.

Schemas, exit codes, and `--json` objects are in `docs/cli.md`.

## Before booking

```bash
preebs config show --json
```

Pick ids from `config.projects[].tasks[].hourTypes[]`. Ids are stable. A name or project label works only when it matches one entity. If the command exits 5, the name is ambiguous: ask for or use the id.

Resolve the calendar date as `YYYY-MM-DD`. Do not guess an ambiguous date. Any date in a week selects that Monday–Friday week.

## Workflow

1. `preebs config show --json`
2. Book with ids.
3. Report the date, hours, project, task, hour type, day total, and daily maximum from the booking.
4. Confirm with `preebs week show --date YYYY-MM-DD --json` when the user wants the whole week.

## Commands

```bash
preebs config show --json
preebs config set --max-hours 8,8,8,8,8 --json
preebs config set --default-hour-type "Consulting" --json

preebs project list --json
preebs project add --name "EBS name" --label "Human name" --json
preebs task add --project PROJECT_ID --name "Design" --json
preebs task add --project PROJECT_ID --name "Build" --label "Bouw" --hour-type "Straight Time" --json
preebs task edit TASK_ID --label "" --hour-type "Overtime" --json

preebs weeks --json
preebs week show --date 2026-09-25 --json

preebs book \
  --date 2026-09-25 \
  --project PROJECT_ID \
  --task TASK_ID \
  --hours 7.5 \
  --json

preebs book \
  --date 2026-09-25 \
  --project PROJECT_ID \
  --task TASK_ID \
  --hour-type HOUR_TYPE_ID \
  --hours 7,5 \
  --note "Worked on accessibility" \
  --json

preebs export --date 2026-09-25 --json
preebs export --date 2026-09-25 --output ~/Downloads/ebs-hours.json --json

preebs migrate --from ./data/preebs-db.json --json
```

Pass `--json` whenever a program will read the result. Add `--dry-run` to validate a write without keeping it. `--db` or `--data-dir` selects a database other than the default shared file.

## Booking rules

- `book` sets the cell. It does not add. Repeating the same command is safe.
- Hours are `0` through `24` in steps of `0.5`. Both `7.5` and `7,5` are accepted.
- Only Monday through Friday can be booked.
- The task must belong to the project. The hour type must belong to the task.
- A task has exactly one hour type, so `--hour-type` may be omitted. The name must still be that hour type when you pass it.
- A booking that would exceed `maxHoursPerDay` is rejected and changes nothing.
- `--hours 0` clears that day. The row can remain.
- A note belongs to the whole row. Omit `--note` to keep it. `--note ""` clears it.
- `--label ""` clears a project or task display label. Omitting `--label` leaves it. Export uses the EBS name, not the label.

Exit codes: `0` ok, `1` unexpected, `2` validation or usage, `3` not found, `4` conflict, `5` ambiguous name. With `--json`, stderr is `{ "error", "code" }`.

## Export

- `export` accepts any date in the week and writes Monday through Friday.
- The file is the JSON the Chrome and Firefox extensions already import. Notes are not in it.
- The default path is `./preebs-WEEK-MONDAY.json`.
- Export never overwrites. If the file exists, pick another `--output` or ask before replacing it.
- Report the `output` path from the JSON so the user can select it in the extension.

## Config transfer and migration

- `preebs config export` writes `preebs-config` version 1. It includes `defaultHourTypeName`. It does not overwrite.
- `preebs config import <file>` replaces config and keeps weeks. Old files without `defaultHourTypeName` import as `Straight Time`. A missing task `label` stays empty. Several hour types on one task collapse to the first name that is not `Straight Time`.
- `preebs migrate` copies a legacy `preebs-db.json` once. It is safe to run again. Config is replaced. Weeks in the file are upserted. Other SQLite weeks stay. The JSON file is not deleted.

Changing the default hour type does not rename hour types already stored on tasks.
