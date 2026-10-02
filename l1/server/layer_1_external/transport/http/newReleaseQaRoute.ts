/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/newReleaseQaRoute.ts" enhancement="_blank" />

import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

export interface NewReleaseQaAccess {
  mode: ProjectMode;
  host: string;
  remoteAddress: string;
}

function hostName(value: string): string {
  const host = value.trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']') >= 0 ? host.indexOf(']') : undefined);
  const firstColon = host.indexOf(':');
  const lastColon = host.lastIndexOf(':');
  return firstColon > 0 && firstColon === lastColon && /^\d+$/u.test(host.slice(firstColon + 1))
    ? host.slice(0, firstColon)
    : host;
}

export function isQaLoopback(value: string): boolean {
  const address = hostName(value).replace(/^::ffff:/u, '');
  if (address === 'localhost' || address === '::1') return true;
  const octets = address.split('.');
  return octets.length === 4 && octets[0] === '127'
    && octets.every(octet => /^(?:0|[1-9]\d{0,2})$/u.test(octet) && Number(octet) <= 255);
}

export function canServeNewReleaseQa(input: NewReleaseQaAccess): boolean {
  return (input.mode === 'development' || input.mode === 'presentation')
    && isQaLoopback(input.host) && isQaLoopback(input.remoteAddress);
}

export function newReleaseQaProjectHint(url: string): number {
  const raw = new URL(url, 'http://qa.local').searchParams.get('project');
  if (raw === null) return 102047;
  return /^[1-9]\d{5}$/u.test(raw) ? Number(raw) : 0;
}

export function buildNewReleaseQaHtml(release: string, projectHint: number): string {
  const bootstrap = JSON.stringify({ release, projectHint }).replace(/</gu, '\\u003c');
  const project = projectHint > 0 ? String(projectHint) : '0';
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>New release QA</title>
  <script type="importmap">{"imports":{"lit":"/_libs/lit/index.js","lit/decorators.js":"/_libs/lit/decorators.js"}}</script>
  <script>
    window.collabBoot={projectId:${JSON.stringify(project)},clientProjectId:${JSON.stringify(project)},moduleId:"__qa",basePath:"/__qa/new-release",shellMode:"qa",pageTitle:"New release QA",routes:[],appEnv:"presentation"};
    window.__newReleaseQaBootstrap=${bootstrap};
  </script>
  <style>html,body{margin:0;min-height:100%;background:#eef1f5;color:#263445;font-family:Inter,system-ui,sans-serif}body{padding:12px}body[data-theme="dark"]{background:#111827;color:#e5e7eb}.qa-error{max-width:760px;margin:40px auto;padding:20px;border:1px solid #d33;border-radius:12px;background:#fff;color:#8b1a1a}</style>
</head>
<body><new-release-qa-preview-102035></new-release-qa-preview-102035><script type="module" src="/_102035_/l2/newRelease/qaPreview.js"></script></body>
</html>`;
}
