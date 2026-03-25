/// <mls fileReference="_102034_/l2/audit/web/shared/home.defs.ts" enhancement="_blank" />
export const skill = `
# Audit Home Page

## Purpose

Render the overview page for the audit module. This page must explain the audit
architecture and summarize the two operational trails: audit log and status
history.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`audit.home.load\`
- The routine must return only what the overview page needs:
  - environment/runtime summary
  - recent volume cards for audit log and status history
  - explanation of the difference between the two trails
  - recent relevant events
  - grouped distribution by module, entity type and actor

## Page Behavior

- Detect the active section by the current pathname
- Treat \`/audit\`, \`/audit/index.html\` and \`/audit/overview\` as overview
- Use the left aside as the primary navigation
- Do not duplicate page links in the header
- Render top cards first, then the conceptual comparison block, then condensed
  lists/tables

## Visual Intent

- Same shell direction as the monitor module
- Dense operational cards with neutral diagnostic styling
- Clear comparison block titled \`Audit Log vs Status History\`
- Header reserved for title, current context and refresh/filter actions

## Conceptual Contract

- \`audit log\` answers who changed what
- \`status history\` answers how the entity status changed over time
- The initial operational sources are \`mdm_audit_log\` and
  \`mdm_status_history\`, but the page narrative must be generic enough for
  future expansion
`;
