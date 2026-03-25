/// <mls fileReference="_102034_/l2/monitor/web/shared/dynamodb.defs.ts" enhancement="_blank" />
export const skill = `
# Monitor DynamoDB Page

## Purpose

Render the DynamoDB diagnostics page for the monitor module.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`monitor.dynamodb.load\`
- The routine must return:
  - region
  - summary of available/missing tables
  - table status, item count and size

## Page Behavior

- Load only when the current pathname is \`/monitor/dynamodb\`
- Render summary cards first
- Render a table with per-table status and storage information

## Layout Intent

- Compact operational table
- Highlight missing or unavailable tables clearly
`;
