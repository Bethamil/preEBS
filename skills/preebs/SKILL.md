---
name: preebs
description: Book and inspect work hours in PreEBS through its CLI. Use this skill whenever a user asks an agent to register, change, check, or list timesheet hours, projects, tasks, weekdays, or PreEBS weeks, even when they only describe the work and date informally.
compatibility: Requires Node.js 18+ and a running PreEBS server with the preebs CLI available.
---

# PreEBS

Use the `preebs` CLI instead of editing the JSON database or calling the API directly. Successful commands return JSON; failures write a useful message to stderr and exit non-zero.

## Connection

The CLI automatically connects to a running PreEBS desktop app and otherwise defaults to `http://localhost:3000`. If it runs elsewhere, set `PREEBS_URL` once or pass `--url URL` to every command.

Before booking, verify that PreEBS is reachable:

```bash
preebs config
```

If the executable is unavailable inside the PreEBS repository, use `npm run cli --` in place of `preebs`.

## Workflow

1. Run `preebs config` and select IDs from the returned `config.projects[].tasks[].hourTypes[]` hierarchy.
2. Resolve the user's requested calendar date as `YYYY-MM-DD`. Do not guess an ambiguous date; ask one short clarification question.
3. Book with project and task IDs, not display names.
4. Read the returned booking and report the date, hours, project/task, day total, and daily maximum.
5. If the user wants confirmation, run `preebs week --date YYYY-MM-DD`.

## Commands

```bash
# Configuration with valid project, task, and hour-type IDs
preebs config

# Existing week summaries
preebs weeks

# Full week containing this date; any date in the week is accepted
preebs week --date 2026-09-25

# Set hours for one workday and configured combination
preebs book \
  --date 2026-09-25 \
  --project PROJECT_ID \
  --task TASK_ID \
  --hours 7.5

# Optional hour type and row note
preebs book \
  --date 2026-09-25 \
  --project PROJECT_ID \
  --task TASK_ID \
  --hour-type HOUR_TYPE_ID \
  --hours 7.5 \
  --note "Worked on accessibility"
```

## Booking Semantics

- `book` sets the cell to the requested hours. It does not add hours. Repeating the same command is safe.
- Hours must be `0` through `24`, in increments of `0.5`. Both `7.5` and `7,5` are accepted by the CLI.
- Only Monday through Friday can be booked.
- The task must belong to the selected project and the hour type must belong to the selected task.
- Omit `--hour-type` only when the task has exactly one configured hour type.
- A booking that would exceed `maxHoursPerDay` is rejected without changing the week.
- Use `--hours 0` to clear that date's hours for the combination. The row can remain in the week.
- A note belongs to the entire project/task/hour-type row, not to an individual day. Only pass `--note` when the user intends to set or replace that row note.

Never bypass a validation failure by modifying `data/preebs-db.json`. Explain the failure and ask for corrected input when needed.
