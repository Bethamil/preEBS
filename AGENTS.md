# PreEBS Agent Guide

This file defines how coding/design agents should work in this repository.

## Product Intent
PreEBS is a UX-first weekly timesheet app used as a staging layer before EBS entry.

Primary goal: make weekly entry dramatically faster and clearer than EBS.

## Stack
- Next.js 16 App Router
- TypeScript (strict)
- Tailwind CSS v4
- Local file-backed NoSQL document store (`data/preebs-db.json`)

## Non-Negotiables
- UX quality is the top priority.
- Keyboard-first workflows must remain fast.
- Keep Monday-Friday entry clear and predictable.
- Do not regress accessibility (focus states, labels, contrast).
- Do not introduce horizontal scrolling in the core week-entry workflow.

## Week Entry Rules
- Preserve strong overview for large workloads (example: 3 projects x 10 tasks).
- Grouping and totals must stay easy to scan.
- Keep totals consistent:
  - per day
  - per row
  - per project (if grouped)
  - per week
- Respect max-hours settings (`maxHoursPerDay`).
- Do not allow duplicate logical entries for the same combination within the same week row set:
  - `projectId + taskId + hourTypeId` should be unique in a week.

## Export Rules
- Export hierarchy must remain: `day -> projects -> tasks -> hour types`.
- Always include all 5 weekdays in export.
- Include both IDs and names in exported nodes.
- Preserve deterministic ordering (Mon-Fri, then configured project/task/hourType order).

## Code Conventions
- Prefer small, composable React components.
- Keep domain logic in `lib/*` and UI logic in `components/*`.
- Reuse typed helpers (`lib/types.ts`, `lib/utils.ts`, `lib/date.ts`).
- Avoid introducing heavy dependencies without clear value.

## Performance
- Avoid unnecessary re-renders in week entry.
- Keep interactions instant-feeling.
- Maintain autosave behavior and optimistic-feeling UI feedback.

## Validation Before Finishing
Run:
1. `npm run typecheck`
2. `npx next build --webpack`

If Turbopack fails in sandboxed environments, report that separately and still verify webpack build.

## Change Safety
- Do not remove existing data model fields without migration handling.
- Preserve backwards compatibility for stored week/config documents when possible.
- If behavior changes significantly, update `README.md`.
