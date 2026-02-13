# PreEBS

PreEBS is a UX-first weekly timesheet app designed for people who still have to submit into EBS later.

## Stack

- Next.js 16 (App Router)
- Tailwind CSS v4
- File-backed NoSQL document store (JSON documents in `data/preebs-db.json`)

## Features

- `/config`: manage Projects, Tasks, Hour Types, max-hours rule, and optional blocking when exceeded.
- `/week/[weekStartDate]`: high-speed weekly entry (Mon-Fri) with project tabs, keyboard navigation, totals, warnings, and auto-save.
- `/weeks`: saved week overview with totals, exceeded indicators, search, and export.
- Export per-week nested JSON grouped by day -> projects -> tasks -> hour types.

## UX Pattern Choice

The week-entry page uses **project tabs with a compact weekly grid**.

Why this pattern:

- Scales well for many tasks (for example 3 projects x 10 tasks) by reducing visible scope.
- Keeps all weekday cells visible for fast keyboard entry.
- Preserves context: users can focus on one project at a time or switch to "All Projects".

## Quality-of-life features implemented

- Copy previous week
- Duplicate row
- Clear day (per weekday)
- Recently used task/hour-type shortcuts
- Keyboard shortcuts: `Alt+N` add row, `Ctrl/Cmd+S` save

## Local development

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`
3. Open:
   - [http://localhost:3000](http://localhost:3000)

## Data model (NoSQL)

The JSON document database stores:

- `users[]`
- `configs[userId]`
  - `maxHoursPerWeek`
  - `blockOnMaxHoursExceed`
  - `projects[]`
    - `tasks[]`
      - `hourTypes[]`
- `weeks[userId:weekStartDate]`
  - row entries with stable ids and both IDs + names snapshots

Weeks are keyed by `userId + weekStartDate` and remain fully editable.

## Export format

`GET /api/weeks/:weekStartDate/export`

Returns nested JSON containing all weekdays (Mon-Fri), with consistent totals and deterministic ordering:

- `days[]`
  - `projects[]`
    - `tasks[]`
      - `hourTypes[]`

Each level includes IDs and display names.
