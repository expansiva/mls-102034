/// <mls fileReference="_102034_/l2/audit/module.defs.ts" enhancement="_blank" />
export const skill = {
  moduleId: 'audit',
  purpose: 'Operational audit module for reading change traceability and lifecycle history. Audit log answers who changed what; status history answers how entity state changed over time.',
  pages: ['home', 'audit-log', 'status-history'],
  genome: {
    page11: 'desktop-standard',
    page21: 'mobile-standard',
  },
  states: [
    'ui.audit.currentSection',
    'ui.audit.refreshTick',
  ],
} as const;
