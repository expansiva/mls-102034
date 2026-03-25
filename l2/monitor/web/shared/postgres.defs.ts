/// <mls fileReference="_102034_/l2/monitor/web/shared/postgres.defs.ts" enhancement="_blank" />
export const skill = `
# Monitor Postgres Page

## Purpose

Render a focused Postgres diagnostics page for the monitor module.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`monitor.postgres.load\`
- The routine must return:
  - database activity summary
  - cache hit ratio
  - waiting locks
  - queue and cache counts
  - known application tables with row counts and total size

## Page Behavior

- Load only when the current pathname is \`/monitor/postgres\`
- Render top-level health cards
- Render queue/cache cards
- Render a table of known Postgres tables

## Layout Intent

- Diagnostic, table-heavy layout
- Emphasis on operational bottlenecks and storage footprint
`;
