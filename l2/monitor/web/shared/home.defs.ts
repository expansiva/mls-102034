/// <mls fileReference="_102034_/l2/monitor/web/shared/home.defs.ts" enhancement="_blank" />
export const skill = `
# Monitor Home Page

## Purpose

Render the operational home page for the monitor module using a single
aggregated BFF request.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`monitor.home.load\`
- The routine must return only what the overview page needs:
  - system/runtime summary
  - BFF overview counts
  - by-routine ranking
  - recent failures
  - recent execution series
  - condensed Postgres and DynamoDB status cards

## Page Behavior

- Detect the active section by the current pathname
- Treat \`/monitor\`, \`/monitor/index.html\` and \`/monitor/overview\` as overview
- Render a header with refresh status and a manual refresh button
- Show dense operational cards first
- Show ranked routine activity and recent failures
- Keep the page compatible with the master shell aside/header

## Shared Files

- \`web/shared/home.ts\` owns the BFF call
- \`web/shared/homeFormatters.ts\` owns reusable formatting helpers

## Layout Intent

- Fast scan for operations
- Dense but readable dashboard
- Neutral colors with explicit severity accents
- Tailwind-first styling in light DOM
`;
