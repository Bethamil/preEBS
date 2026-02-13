# PreEBS

PreEBS is a UX-first weekly timesheet app designed for people who still have to submit into EBS later.

## Stack

- Next.js 16 (App Router)
- Tailwind CSS v4
- File-backed NoSQL document store (JSON documents in `data/preebs-db.json`)

## Features

- `/config`: manage Projects, Tasks, Hour Types, and per-day (Mon-Fri) max-hour limits.
- `/week/[weekStartDate]`: high-speed weekly entry (Mon-Fri) with collapsible project panels, compact weekly grid, keyboard navigation, sticky totals footer, warnings, and auto-save.
- `/weeks`: saved week overview with totals, exceeded indicators, search, and export.
- Export per-week nested JSON grouped by day -> projects -> tasks -> hour types.

## UX Pattern Choice

The week-entry page uses **collapsible project panels with a compact weekly grid**.

Why this pattern:

- Scales well for many tasks (for example 3 projects x 10 tasks) by reducing visible scope.
- Keeps all weekday cells visible for fast keyboard entry.
- Keeps context clear with per-project totals, row/task counts, and status indicators in every project header.
- Expands the last edited project by default so users return to their active section immediately.

## Quality-of-life features implemented

- Copy previous week
- Duplicate row
- Clear day (per weekday)
- Searchable quick-add combos (project/task/hour type in one action)
- Hover-revealed row actions with compact `...` menu
- Keyboard shortcuts: `Alt+N` add row, `Alt+D` duplicate focused row, `Alt+F` fill previous values, `Ctrl/Cmd+S` save

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
  - `maxHoursPerDay` (Mon-Fri)
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
