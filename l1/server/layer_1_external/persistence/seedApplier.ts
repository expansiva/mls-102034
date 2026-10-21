/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/seedApplier.ts" enhancement="_blank" />
import type { ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { usesPostgres } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  isTestSeedEligible,
  selectEligibleSeedRows,
  type SeedModeInput,
} from '/_102034_/l1/server/layer_1_external/persistence/seedPolicy.js';

export interface SeedApplyCounts {
  initialInserted: number;
  initialConflicts: number;
  testInserted: number;
}

export interface SeedApplyInput {
  projectMode: (projectId: string) => ProjectMode;
  serverMode: ProjectMode;
  /** Physical names created by this rebuild. Test rows are written only for these tables. */
  rebuiltTableNames: ReadonlySet<string>;
}

interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** JSONB is sent as text. Array columns keep the JS array so node-pg binds the array type. */
export function serializeSeedValue(postgresType: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return postgresType.endsWith('[]') ? value : JSON.stringify(value);
}

export function buildSeedInsertSql(
  tableName: string,
  columnNames: string[],
  purpose: 'initial' | 'test',
): string {
  const columns = columnNames.map((name) => quoteIdentifier(name)).join(', ');
  const placeholders = columnNames.map((_, index) => `$${index + 1}`).join(', ');
  const conflict = purpose === 'initial' ? ' ON CONFLICT DO NOTHING' : '';
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${placeholders})${conflict}`;
}

function modeInput(definition: ResolvedTableDefinition, input: SeedApplyInput): SeedModeInput {
  return {
    tableName: definition.tableName,
    logicalTableName: definition.logicalTableName,
    projectMode: input.projectMode(definition.projectId),
    serverMode: input.serverMode,
  };
}

function bindRow(
  definition: ResolvedTableDefinition,
  row: Record<string, unknown>,
): { names: string[]; values: unknown[] } | null {
  const columns = definition.columns.filter((column) => row[column.name] !== undefined);
  if (columns.length === 0) {
    return null;
  }
  return {
    names: columns.map((column) => column.name),
    values: columns.map((column) => serializeSeedValue(column.postgresType, row[column.name])),
  };
}

function initialOrigin(definition: ResolvedTableDefinition): string {
  const sources = (definition.seedOrigins ?? [])
    .filter((origin) => origin.purpose === 'initial')
    .map((origin) => origin.source);
  return sources.length > 0 ? sources.join(', ') : 'unknown';
}

/**
 * Writes initial rows for every Postgres table, then test rows only for tables created
 * in this rebuild and only when the mode allows them. Initial uses ON CONFLICT DO NOTHING
 * so an existing key is left unchanged. A test row that collides with initial is omitted
 * before INSERT; other test failures stay non-fatal for that table.
 */
export async function applySeedRows(
  pool: Queryable,
  definitions: ResolvedTableDefinition[],
  input: SeedApplyInput,
): Promise<SeedApplyCounts> {
  const counts: SeedApplyCounts = { initialInserted: 0, initialConflicts: 0, testInserted: 0 };
  const postgres = definitions.filter((definition) => usesPostgres(definition));

  for (const definition of postgres) {
    const initial = definition.initialSeedRows ?? [];
    if (initial.length === 0) {
      continue;
    }
    for (const row of initial) {
      const bound = bindRow(definition, row);
      if (!bound) {
        continue;
      }
      const sql = buildSeedInsertSql(definition.tableName, bound.names, 'initial');
      let rowCount: number | null;
      try {
        const result = await pool.query(sql, bound.values);
        rowCount = result.rowCount;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `initial seed failed for "${definition.tableName}" (origin ${initialOrigin(definition)}): ${message}`,
          { cause: error },
        );
      }
      if (rowCount && rowCount > 0) {
        counts.initialInserted += rowCount;
      } else {
        counts.initialConflicts += 1;
      }
    }
  }

  for (const definition of postgres) {
    if (!input.rebuiltTableNames.has(definition.tableName)) {
      continue;
    }
    const modes = modeInput(definition, input);
    if (!isTestSeedEligible(modes)) {
      continue;
    }
    const eligible = selectEligibleSeedRows(definition, modes);
    const initialCount = definition.initialSeedRows?.length ?? 0;
    const testRows = eligible.slice(initialCount);
    if (testRows.length === 0) {
      continue;
    }
    try {
      for (const row of testRows) {
        const bound = bindRow(definition, row);
        if (!bound) {
          continue;
        }
        const result = await pool.query(
          buildSeedInsertSql(definition.tableName, bound.names, 'test'),
          bound.values,
        );
        if (result.rowCount && result.rowCount > 0) {
          counts.testInserted += result.rowCount;
        }
      }
    } catch (error) {
      console.warn(
        `[seedApplier] test seed failed for "${definition.tableName}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return counts;
}
