/// <mls fileReference="_102034_/l2/audit/web/shared/auditLog.defs.ts" enhancement="_blank" />
export const skill = `
# Audit Log Page

## Purpose

Render the change-traceability page for the audit module, focused on the
\`mdm_audit_log\` trail.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`audit.auditLog.load\`
- The routine must return:
  - overview totals for audit activity
  - grouped cuts by module, routine, actor and action
  - a paginated event list
  - enough data to open event details

## Filters

- \`module\`
- \`entityType\`
- \`entityId\`
- \`actorId\`
- \`actorType\`
- \`action\`
- period / date range

## Page Behavior

- Load only when the current pathname is \`/audit/audit-log\`
- Use the left aside as the primary navigation
- Keep the header free of duplicated page links
- Render summary cards first and the event table after that
- Provide access to event detail inspection
- Reserve a detailed remote-record view when a DynamoDB-backed \`diff\` exists

## Visual Intent

- Diagnostic and table-heavy layout
- Emphasis on data changes, actor traceability and routine provenance
- Neutral colors with explicit highlighting for destructive or exceptional
  actions

## Conceptual Contract

- This page is about immutable records of create, update, delete and restore
  operations
- The user should understand that this trail captures what changed and who
  caused it
- This page must not be framed as lifecycle/status analytics
`;
