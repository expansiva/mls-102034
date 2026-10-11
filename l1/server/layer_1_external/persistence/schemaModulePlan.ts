/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/schemaModulePlan.ts" enhancement="_blank" />
import type { SchemaSnapshot } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { sha256Hex } from '/_102034_/l1/server/layer_1_external/platform/webCrypto.js';

type SnapshotTable = SchemaSnapshot['tables'][number];

export type ModuleRebuildMode = 'none' | 'recordOnly' | 'full' | 'modules';

export interface ModuleRebuildPlan {
  mode: ModuleRebuildMode;
  rebuild: string[];
  untouched: string[];
  removed: string[];
}

export interface MigrationReportRebuiltModule {
  moduleId: string;
  tables: number;
  seedRows: number;
}

export interface MigrationReportSummary {
  rebuilt: MigrationReportRebuiltModule[];
  untouched: string[];
  removed: string[];
  orphans?: string[];
}

const MASTER_PROJECT_ID = '102034';

function sortedModuleIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function stateKey(projectId: string, moduleId: string): string {
  return `${projectId}:${moduleId}`;
}

export function parseStateKey(key: string): { projectId: string; moduleId: string } | null {
  const index = key.indexOf(':');
  if (index <= 0 || index === key.length - 1) {
    return null;
  }
  return { projectId: key.slice(0, index), moduleId: key.slice(index + 1) };
}

export async function moduleHashes(tables: SnapshotTable[]): Promise<Map<string, string>> {
  const byModule = new Map<string, SnapshotTable[]>();
  for (const table of tables) {
    const key = stateKey(table.projectId, table.moduleId);
    const list = byModule.get(key) ?? [];
    list.push(table);
    byModule.set(key, list);
  }

  const hashes = new Map<string, string>();
  for (const key of sortedModuleIds(byModule.keys())) {
    const ordered = [...(byModule.get(key) ?? [])].sort((left, right) =>
      left.tableName.localeCompare(right.tableName),
    );
    hashes.set(key, await sha256Hex(JSON.stringify(ordered)));
  }
  return hashes;
}

export function planModuleRebuild(args: {
  current: Map<string, string>;
  applied: Map<string, string> | null;
  lastSnapshotId: string | null;
  currentSnapshotId: string;
  ownProjects: string[];
}): ModuleRebuildPlan {
  const currentIds = sortedModuleIds(args.current.keys());
  const own = new Set(args.ownProjects);
  const clientIds = new Set(args.ownProjects.filter((projectId) => projectId !== MASTER_PROJECT_ID));

  const appliedOwn =
    args.applied === null
      ? null
      : new Map(
          [...args.applied].filter(([key]) => {
            const parsed = parseStateKey(key);
            return parsed !== null && own.has(parsed.projectId);
          }),
        );

  const hasClientState =
    appliedOwn !== null &&
    [...appliedOwn.keys()].some((key) => {
      const parsed = parseStateKey(key);
      return parsed !== null && clientIds.has(parsed.projectId);
    });

  if (!hasClientState) {
    if (args.lastSnapshotId === args.currentSnapshotId) {
      return { mode: 'recordOnly', rebuild: [], untouched: moduleIdsOf(currentIds), removed: [] };
    }
    return { mode: 'full', rebuild: moduleIdsOf(currentIds), untouched: [], removed: [] };
  }

  const rebuild: string[] = [];
  const untouched: string[] = [];
  for (const key of currentIds) {
    const appliedHash = appliedOwn.get(key);
    if (appliedHash === args.current.get(key)) {
      untouched.push(key);
    } else {
      rebuild.push(key);
    }
  }

  const removed = sortedModuleIds(appliedOwn.keys()).filter((key) => {
    if (args.current.has(key)) {
      return false;
    }
    const parsed = parseStateKey(key);
    return parsed !== null && clientIds.has(parsed.projectId);
  });

  const plan = { rebuild: moduleIdsOf(rebuild), untouched: moduleIdsOf(untouched), removed: moduleIdsOf(removed) };
  if (rebuild.length === 0 && removed.length === 0) {
    return { mode: 'none', ...plan };
  }
  return { mode: 'modules', ...plan };
}

// The plan compares by "<projectId>:<moduleId>"; its lists stay moduleIds, which is what the rebuild matches against.
function moduleIdsOf(keys: string[]): string[] {
  return sortedModuleIds(keys.map((key) => parseStateKey(key)?.moduleId ?? key));
}

function formatModuleList(ids: string[]): string {
  return ids.length === 0 ? '—' : ids.join(', ');
}

function formatRebuilt(items: MigrationReportRebuiltModule[]): string {
  if (items.length === 0) {
    return '—';
  }
  return items
    .map((item) => `${item.moduleId} (${item.tables} tabelas, seed: ${item.seedRows} linhas)`)
    .join(', ');
}

export function formatMigrationReport(summary: MigrationReportSummary): string {
  const lines = [
    `[migrate] refeitos (tabelas zeradas): ${formatRebuilt(summary.rebuilt)}`,
    `[migrate] intactos: ${formatModuleList(summary.untouched)}`,
    `[migrate] removidos: ${formatModuleList(summary.removed)}`,
  ];
  if (summary.orphans) {
    lines.push(`[migrate] órfãs (não apagadas): ${formatModuleList(summary.orphans)}`);
  }
  lines.push('[migrate] migração real (preservar dados ao mudar esquema): ainda não existe');
  return lines.join('\n');
}
