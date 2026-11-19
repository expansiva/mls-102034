/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/externalSystems.ts" enhancement="_blank" />
/**
 * What the monitor shows for the outside systems of one module.
 * A secret setting is only filled or missing. Its value never leaves this module.
 */
import type { ExternalCallRow } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalSettingsStore } from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import type { ExternalRef } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type {
  ExternalHost,
  ExternalSystemDeclaration,
} from '/_102034_/l1/server/layer_1_external/connections/external/types.js';

export interface ExternalSystemsDeps {
  systemsOf(projectId: string): Promise<Map<string, string>>;
  declarationOf(ref: ExternalRef): Promise<ExternalSystemDeclaration | null>;
  settings: Pick<ExternalSettingsStore, 'status' | 'settingOf' | 'set'>;
  recentCalls(projectId: string, moduleId: string, systemId: string): Promise<ExternalCallRow[]>;
  writeFailureCount(): number;
  /** `https://host` of this app, or empty when the app has no public domain yet. */
  publicOrigin(): string;
}

export interface ExternalHostView {
  host?: string;
  fromSetting?: string;
  /** Present only when the setting is filled and is not a secret. */
  value?: string;
}

export interface ExternalOperationView {
  operationId: string;
  direction: 'call' | 'serve';
  hook?: string;
}

export interface ExternalSettingView {
  settingId: string;
  status: 'filled' | 'missing';
  secret: boolean;
}

export interface ExternalCallLine {
  occurredAt: string;
  direction: 'out' | 'in';
  operationId: string;
  server: string;
  outcome: string;
  httpStatus: number | null;
  durationMs: number | null;
}

export interface ExternalSystemView {
  systemId: string;
  title: string;
  hosts: ExternalHostView[];
  operations: ExternalOperationView[];
  settings: ExternalSettingView[];
  recent: ExternalCallLine[];
  writeFailureCount: number;
}

export interface ExternalSystemsOfResult {
  systems: ExternalSystemView[];
}

/**
 * App admin: `monitor:admin` (the authority the monitor's own routines carry: the server keeps only the authorities of the
 * module a routine belongs to) or `sites:admin` (the platform's role, for the paths that do not filter). Not any
 * `<module>:admin`: the admin of a generated module, or an agent that holds one, must not read or write the secrets of
 * another system. The monitor's release pages do not check anything yet; this door does.
 */
export function isAppAdmin(authorities: readonly string[] | undefined): boolean {
  return (authorities ?? []).some((item) => item === 'monitor:admin' || item === 'sites:admin');
}

function hookAddress(origin: string, ref: ExternalRef, operationId: string): string {
  const path = `/hook/${ref.projectId}/${ref.moduleId}/${ref.systemId}/${operationId}`;
  const base = origin.replace(/\/+$/u, '');
  return base ? `${base}${path}` : path;
}

function lineOf(row: ExternalCallRow): ExternalCallLine {
  return {
    occurredAt: row.occurredAt,
    direction: row.direction,
    operationId: row.operationId,
    server: row.server.split('?')[0] ?? row.server,
    outcome: row.outcome,
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
  };
}

async function hostView(
  deps: ExternalSystemsDeps,
  ref: ExternalRef,
  declaration: ExternalSystemDeclaration,
  host: ExternalHost,
): Promise<ExternalHostView> {
  if ('host' in host) return { host: host.host };
  const declared = declaration.settings.find((item) => item.id === host.fromSetting);
  if (!declared || declared.secret) return { fromSetting: host.fromSetting };
  const value = await deps.settings.settingOf(ref, host.fromSetting);
  if (value === undefined || value === '') return { fromSetting: host.fromSetting };
  return { fromSetting: host.fromSetting, value };
}

export async function externalSystemsOf(
  deps: ExternalSystemsDeps,
  projectId: string,
  moduleId: string,
): Promise<ExternalSystemsOfResult> {
  const index = await deps.systemsOf(projectId);
  const systems: ExternalSystemView[] = [];
  const ids = [...index.entries()]
    .filter(([, owner]) => owner === moduleId)
    .map(([systemId]) => systemId)
    .sort();

  for (const systemId of ids) {
    const ref: ExternalRef = { projectId, moduleId, systemId };
    const declaration = await deps.declarationOf(ref);
    if (!declaration || declaration.systemId !== systemId) continue;
    const status = await deps.settings.status(projectId, systemId);
    const filled = new Map(status.map((item) => [item.settingId, item.filled]));
    const hosts: ExternalHostView[] = [];
    for (const host of declaration.hosts) {
      hosts.push(await hostView(deps, ref, declaration, host));
    }
    const recent = (await deps.recentCalls(projectId, moduleId, systemId)).slice(0, 50);
    systems.push({
      systemId,
      title: declaration.title,
      hosts,
      operations: declaration.operations.map((operation) => ({
        operationId: operation.operationId,
        direction: operation.direction,
        ...(operation.direction === 'serve'
          ? { hook: hookAddress(deps.publicOrigin(), ref, operation.operationId) }
          : {}),
      })),
      settings: declaration.settings.map((item) => ({
        settingId: item.id,
        status: filled.get(item.id) === true ? 'filled' : 'missing',
        secret: item.secret,
      })),
      recent: recent.map(lineOf),
      writeFailureCount: deps.writeFailureCount(),
    });
  }

  return { systems };
}

export async function setExternalSetting(
  deps: ExternalSystemsDeps,
  ref: ExternalRef,
  settingId: string,
  value: string,
  by: string,
): Promise<{ ok: true } | { ok: false; code: 'disabled' | 'refused' }> {
  const written = await deps.settings.set(ref, settingId, value, by);
  if (!written.ok) return written;
  return { ok: true };
}
