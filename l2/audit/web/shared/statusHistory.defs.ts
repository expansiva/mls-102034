/// <mls fileReference="_102034_/l2/audit/web/shared/statusHistory.defs.ts" enhancement="_blank" />
export const skill = `
# Status History Page

## Purpose

Render the lifecycle-trail page for the audit module, focused on the
\`mdm_status_history\` trail.

## Target Genome

- Device: desktop
- Layout: standard
- Folder: \`web/desktop/page11/\`

## Main Routine

- Use \`audit.statusHistory.load\`
- The routine must return:
  - overview totals for status transitions
  - grouped cuts by module, entity type and transition
  - an ordered transition list
  - enough information to highlight repeated transition patterns and current
    status when derivable

## Filters

- \`module\`
- \`entityType\`
- \`entityId\`
- \`fromStatus\`
- \`toStatus\`
- \`actorId\`
- \`reasonCode\`
- period / date range

## Page Behavior

- Load only when the current pathname is \`/audit/status-history\`
- Use the left aside as the primary navigation
- Keep the header free of duplicated page links
- Render summary cards first and the ordered transition table after that
- Highlight common transitions and status flow bottlenecks when the response
  provides them

## Visual Intent

- Diagnostic, sequence-oriented layout
- Emphasis on lifecycle flow, transition frequency and semantic reasons
- Clear distinction from the diff-oriented audit log page

## Conceptual Contract

- This page is about immutable status transitions with semantic context such as
  \`reason\`, \`reasonCode\` and \`metadata\`
- The user should understand that this trail captures how status moved over
  time, not which fields changed
- This page must not be framed as raw data-diff inspection
`;
