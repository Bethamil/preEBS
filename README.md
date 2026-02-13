# PreEBS

PreEBS is a UX-first weekly timesheet app designed for people who still have to submit into EBS later.

## Stack

- Next.js 16 (App Router)
- Tailwind CSS v4
- File-backed JSON storage (`data/preebs-db.json`)

## Features

- `/config`: manage Projects, Tasks, Hour Types, and per-day (Mon-Fri) max-hour limits.
- `/week/[weekStartDate]`: high-speed weekly entry (Mon-Fri) with collapsible project panels, compact weekly grid, keyboard navigation, exact weekly-hours status (missing/match/over), warnings, and auto-save.
- `/weeks`: saved week overview with totals, exact-hours status (missing/match/over), search, and export.
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
- Add same hours to existing row
- Add custom projects directly in week entry (with free-text tasks for custom rows)
- Clear day (per weekday)
- Searchable quick-add combos (project/task/hour type in one action)
- Simple per-row delete action
- Quick search focus shortcut: `Cmd/Ctrl + K`

## Local development

1. Install dependencies:
   - `npm install`
2. Start dev server:
   - `npm run dev`
3. Open:
   - [http://localhost:3000](http://localhost:3000)

## Production with Docker

The repository includes a production-ready multi-stage `Dockerfile` and a `docker-compose.yml`.

### Build and run with Docker

1. Build the image:
   - `docker build -t preebs:latest .`
2. Run the container:
   - `docker run -d --name preebs -p 43117:3000 -v preebs-data:/app/data --restart unless-stopped preebs:latest`

### Build and run with Docker Compose

1. Start in detached mode:
   - `docker compose up -d --build`
2. Stop:
   - `docker compose down`

By default, Docker Compose publishes the app on `http://localhost:43117`. To use a different host port:
- `PREEBS_HOST_PORT=44001 docker compose up -d --build`

The app persists its JSON database in `/app/data/preebs-db.json`. Mount `/app/data` to a volume in production to keep data across deploys/restarts.

## Data model (JSON file storage)

The JSON storage file stores:

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
