/// <mls fileReference="_102034_/l2/monitor/module.ts" enhancement="_blank" />
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
  currentSection: 'ui.monitor.currentSection',
  refreshTick: 'ui.monitor.refreshTick',
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
  pageTitle: 'monitor',
  device: 'desktop',
  navigation: [
    { id: 'overview', label: 'Overview', href: '/monitor', description: 'System status and endpoint activity' },
    { id: 'process', label: 'Process', href: '/monitor/process', description: 'Node.js runtime health — memory, uptime, load' },
    { id: 'architecture', label: 'Architecture', href: '/monitor/architecture', description: 'Module topology and storage design' },
    { id: 'postgres', label: 'Postgres', href: '/monitor/postgres', description: 'Tables, cache and queue status' },
    { id: 'dynamodb', label: 'DynamoDB', href: '/monitor/dynamodb', description: 'Tables and storage status' },
    { id: 'trace', label: 'Trace', href: '/monitor/trace', description: 'Correlate requests by requestId or traceId' },
  ],
  headerRenderer: {
    entrypoint: '/_102034_/l2/monitor/web/desktop/page11/header.js',
    tag: 'monitor-web-desktop-header',
  },
  asideRenderer: {
    entrypoint: '/_102034_/l2/monitor/web/desktop/page11/aside.js',
    tag: 'monitor-web-desktop-aside',
  },
  routes: [
    {
      path: '/monitor',
      aliases: ['/monitor/index.html', '/monitor/overview'],
      entrypoint: '/_102034_/l2/monitor/web/routes/overview.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Overview',
    },
    {
      path: '/monitor/architecture',
      entrypoint: '/_102034_/l2/monitor/web/routes/architecture.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Architecture',
    },
    {
      path: '/monitor/postgres',
      entrypoint: '/_102034_/l2/monitor/web/routes/postgres.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Postgres',
    },
    {
      path: '/monitor/dynamodb',
      entrypoint: '/_102034_/l2/monitor/web/routes/dynamodb.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'DynamoDB',
    },
    {
      path: '/monitor/postgres/tables',
      entrypoint: '/_102034_/l2/monitor/web/routes/postgres-table.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Postgres table',
      matchMode: 'prefix',
    },
    {
      path: '/monitor/dynamodb/tables',
      entrypoint: '/_102034_/l2/monitor/web/routes/dynamodb-table.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'DynamoDB table',
      matchMode: 'prefix',
    },
    {
      path: '/monitor/process',
      entrypoint: '/_102034_/l2/monitor/web/routes/process.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Process',
    },
    {
      path: '/monitor/trace',
      entrypoint: '/_102034_/l2/monitor/web/routes/trace.js',
      tag: 'monitor-web-desktop-home-page',
      title: 'Trace',
    },
  ],
};
