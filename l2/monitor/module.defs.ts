/// <mls fileReference="_102034_/l2/monitor/module.defs.ts" enhancement="_blank" />
export const skill = {
  moduleId: 'monitor',
  purpose: 'Operational monitoring module for system overview, Postgres diagnostics and DynamoDB diagnostics.',
  pages: ['home', 'postgres', 'dynamodb'],
  genome: {
    page11: 'desktop-standard',
    page21: 'mobile-standard',
  },
  states: [
    'ui.monitor.currentSection',
    'ui.monitor.refreshTick',
  ],
} as const;
