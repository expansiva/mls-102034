/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/seedPolicy.ts" enhancement="_blank" />
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { isTestMode, type ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import type {
  SeedExportOrigin,
  SeedPurpose,
  TableIndexColumnDefinition,
  TableIndexDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

export interface SeedPolicyColumn {
  name: string;
  nullable?: boolean;
}

/** Table fields the seed policy needs. Rows are read and never written. */
export interface SeedPolicyTable {
  tableName: string;
  logicalTableName: string;
  storageProfile: string;
  columns: SeedPolicyColumn[];
  primaryKey: string[];
  indexes?: TableIndexDefinition[];
  seedRows?: ReadonlyArray<Record<string, unknown>>;
  initialSeedRows?: ReadonlyArray<Record<string, unknown>>;
}

export interface SeedModeInput {
  tableName: string;
  logicalTableName: string;
  projectMode: ProjectMode;
  serverMode: ProjectMode;
}

const PURPOSE_VALUES: readonly SeedPurpose[] = ['initial', 'test'];

export function readSeedPurpose(value: unknown, origin: Pick<SeedExportOrigin, 'source' | 'seedFor'>): SeedPurpose {
  if (value === undefined) {
    return 'test';
  }
  if (typeof value === 'string' && (PURPOSE_VALUES as readonly string[]).includes(value)) {
    return value as SeedPurpose;
  }
  throw seedError('unknown seed purpose', {
    source: origin.source,
    seedFor: origin.seedFor,
    purpose: value,
  });
}

/** Unprefixed physical name ⇒ platform table. Platform seeds follow serverMode. */
export function isPlatformSeedTable(table: Pick<SeedPolicyTable, 'tableName' | 'logicalTableName'>): boolean {
  return table.tableName === table.logicalTableName;
}

export function seedModeFor(input: SeedModeInput): { platform: boolean; mode: ProjectMode } {
  const platform = isPlatformSeedTable(input);
  return { platform, mode: platform ? input.serverMode : input.projectMode };
}

/** Initial is always eligible. Test follows the same mode rule as today. */
export function isTestSeedEligible(input: SeedModeInput): boolean {
  return isTestMode(seedModeFor(input).mode);
}

function indexColumnName(column: TableIndexColumnDefinition): string {
  return typeof column === 'string' ? column : column.name;
}

function columnUsable(columns: Map<string, SeedPolicyColumn>, name: string): boolean {
  const column = columns.get(name);
  return !!column && column.nullable !== true;
}

/** PK, then unique indexes with no predicate, whose columns all exist and are not nullable. */
export function completeUniqueKeys(table: Pick<SeedPolicyTable, 'columns' | 'primaryKey' | 'indexes'>): string[][] {
  const columns = new Map(table.columns.map((column) => [column.name, column]));
  const keys: string[][] = [];
  const accept = (names: string[]) => {
    if (names.length > 0 && names.every((name) => columnUsable(columns, name))) {
      keys.push(names);
    }
  };
  accept(table.primaryKey);
  for (const index of table.indexes ?? []) {
    if (!index.unique || index.where) {
      continue;
    }
    accept(index.columns.map(indexColumnName));
  }
  return keys;
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`;
}

function rowKeyToken(row: Record<string, unknown>, columns: string[]): string | null {
  const parts: string[] = [];
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(row, column) || row[column] === null || row[column] === undefined) {
      return null;
    }
    parts.push(stableValue(row[column]));
  }
  return parts.join('\u0000');
}

function seedError(message: string, details: Record<string, unknown>): AppError {
  return new AppError('PERSISTENCE_SEED_INVALID', message, 500, details);
}

/**
 * Initial rows require Postgres, a declared complete unique key, and columns that exist.
 * dynamoOnly has no seed application in this engine and is refused here.
 */
export function assertInitialSeed(
  table: SeedPolicyTable,
  rows: ReadonlyArray<Record<string, unknown>>,
  origin: SeedExportOrigin,
): void {
  const details = {
    source: origin.source,
    projectId: origin.projectId,
    moduleId: origin.moduleId,
    table: table.tableName,
    seedFor: origin.seedFor,
    purpose: 'initial' as const,
  };
  if (table.storageProfile === 'dynamoOnly') {
    throw seedError('initial seed refused: dynamoOnly has no seed application in this engine', details);
  }
  const keys = completeUniqueKeys(table);
  if (keys.length === 0) {
    throw seedError('initial seed requires a complete non-null unique key (primary key or unique index without predicate)', details);
  }
  const known = new Set(table.columns.map((column) => column.name));
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!known.has(column)) {
        throw seedError(`initial seed column "${column}" does not exist on ${table.tableName}`, {
          ...details,
          column,
        });
      }
    }
    const identified = keys.some((key) => rowKeyToken(row, key) !== null);
    if (!identified) {
      throw seedError('initial seed row does not supply a complete non-null unique key', details);
    }
  }
}

/**
 * Selects initial rows always and test rows only in a test mode.
 * A test row that collides with an initial row on any complete unique key is omitted.
 * Returned array is new; `seedRows` and `initialSeedRows` are not modified.
 */
export function selectEligibleSeedRows(table: SeedPolicyTable, input: SeedModeInput): Record<string, unknown>[] {
  const initial = [...(table.initialSeedRows ?? [])];
  if (!isTestSeedEligible(input)) {
    return initial;
  }
  const keys = completeUniqueKeys(table);
  const taken = new Set<string>();
  for (const row of initial) {
    for (const key of keys) {
      const token = rowKeyToken(row, key);
      if (token !== null) {
        taken.add(`${key.join('\u0001')}\u0002${token}`);
      }
    }
  }
  const test = (table.seedRows ?? []).filter((row) => {
    for (const key of keys) {
      const token = rowKeyToken(row, key);
      if (token !== null && taken.has(`${key.join('\u0001')}\u0002${token}`)) {
        return false;
      }
    }
    return true;
  });
  return [...initial, ...test];
}
