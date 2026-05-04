/// <mls fileReference="_102034_/l2/audit/module.ts" enhancement="_blank" />
import type { AuraModuleFrontendDefinition } from '/_102029_/l2/contracts/bootstrap.js'; 

export const moduleGenome = {
  page11: {
    device: 'desktop',
    layout: 'standard',
  },
  page21: {
    device: 'mobile',
    layout: 'standard',
  },
} as const;

export const moduleStates = {
  currentSection: 'ui.audit.currentSection',
  refreshTick: 'ui.audit.refreshTick',
} as const;

export const moduleShellPreferences = {
  layout: {
    asideMode: {
      desktop: 'inline',
      mobile: 'fullscreen',
    },
  },
} as const;

export const moduleFrontendDefinition: AuraModuleFrontendDefinition = {
  pageTitle: 'audit',
  device: 'desktop',
  navigation: [
    { id: 'overview', label: 'Overview', href: '/audit', description: 'Audit overview and trail comparison' },
    { id: 'audit-log', label: 'Audit Log', href: '/audit/audit-log', description: 'Who changed what and when' },
    { id: 'status-history', label: 'Status History', href: '/audit/status-history', description: 'Lifecycle transitions and reasons' },
  ],
  routes: [
    {
      path: '/audit',
      aliases: ['/audit/index.html', '/audit/overview'],
      entrypoint: '/_102034_/l2/audit/web/routes/overview.js',
      tag: 'audit-web-desktop-home-page',
      title: 'Overview',
    },
    {
      path: '/audit/audit-log',
      entrypoint: '/_102034_/l2/audit/web/routes/audit-log.js',
      tag: 'audit-web-desktop-home-page',
      title: 'Audit Log',
    },
    {
      path: '/audit/status-history',
      entrypoint: '/_102034_/l2/audit/web/routes/status-history.js',
      tag: 'audit-web-desktop-home-page',
      title: 'Status History',
    },
  ],
};
