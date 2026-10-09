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
}

function sortedModuleIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export async function moduleHashes(tables: SnapshotTable[]): Promise<Map<string, string>> {
  const byModule = new Map<string, SnapshotTable[]>();
  for (const table of tables) {
    const list = byModule.get(table.moduleId) ?? [];
    list.push(table);
    byModule.set(table.moduleId, list);
  }

  const hashes = new Map<string, string>();
  for (const moduleId of sortedModuleIds(byModule.keys())) {
    const ordered = [...(byModule.get(moduleId) ?? [])].sort((left, right) =>
      left.tableName.localeCompare(right.tableName),
    );
    hashes.set(moduleId, await sha256Hex(JSON.stringify(ordered)));
  }
  return hashes;
}

export function planModuleRebuild(args: {
  current: Map<string, string>;
  applied: Map<string, string> | null;
  lastSnapshotId: string | null;
  currentSnapshotId: string;
}): ModuleRebuildPlan {
  const currentIds = sortedModuleIds(args.current.keys());

  if (args.applied === null) {
    if (args.lastSnapshotId === args.currentSnapshotId) {
      return { mode: 'recordOnly', rebuild: [], untouched: currentIds, removed: [] };
    }
    return { mode: 'full', rebuild: currentIds, untouched: [], removed: [] };
  }

  const rebuild: string[] = [];
  const untouched: string[] = [];
  for (const moduleId of currentIds) {
    const appliedHash = args.applied.get(moduleId);
    if (appliedHash === args.current.get(moduleId)) {
      untouched.push(moduleId);
    } else {
      rebuild.push(moduleId);
    }
  }

  const removed = sortedModuleIds(args.applied.keys()).filter((moduleId) => !args.current.has(moduleId));

  if (rebuild.length === 0 && removed.length === 0) {
    return { mode: 'none', rebuild, untouched, removed };
  }
  return { mode: 'modules', rebuild, untouched, removed };
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
  return [
    `[migrate] refeitos (tabelas zeradas): ${formatRebuilt(summary.rebuilt)}`,
    `[migrate] intactos: ${formatModuleList(summary.untouched)}`,
    `[migrate] removidos: ${formatModuleList(summary.removed)}`,
    `[migrate] migração real (preservar dados ao mudar esquema): ainda não existe`,
  ].join('\n');
}
