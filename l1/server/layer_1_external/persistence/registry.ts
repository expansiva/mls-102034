/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/registry.ts" enhancement="_blank" />
import { readdirSync } from 'node:fs';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  readProjectsConfig,
  resolveProjectDistPath,
  resolveProjectModuleImportUrl,
  type ProjectPersistenceModuleConfig,
} from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type {
  ResolvedTableDefinition,
  SchemaSnapshot,
  TableDefinition,
  TableSeedRows,
  ViewDefinition,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import {
  applyProjectTableNamespace,
  resolveDynamoTableName,
  resolvePostgresTableName,
  resolveRepositoryName,
  usesDynamo,
  usesPostgres,
} from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { sha256Hex } from '/_102029_/l2/webCrypto.js';

interface PersistenceModuleRegistration {
  projectId: string;
  projectType?: string;
  moduleId: string;
  persistenceEntrypoint?: string;
  tableDefsDir?: string;
}

interface ImportedPersistenceDefinitions {
  definitions: TableDefinition[];
  seeds: TableSeedRows[];
  seedSource: string;
}

const registryCache = new Map<AppEnv['appEnv'], Promise<ResolvedTableDefinition[]>>();

function getPersistenceModuleRegistrations(): PersistenceModuleRegistration[] {
  const config = readProjectsConfig();
  return Object.entries(config.projects).flatMap(([projectId, project]) =>
    (project.persistenceModules ?? []).map((moduleConfig: ProjectPersistenceModuleConfig) => ({
      projectId,
      projectType: project.type,
      moduleId: moduleConfig.moduleId,
      persistenceEntrypoint: moduleConfig.persistenceEntrypoint,
      tableDefsDir: moduleConfig.tableDefsDir,
    })),
  );
}

function isTableDefinition(value: unknown): value is TableDefinition {
  return !!value
    && typeof value === 'object'
    && typeof (value as TableDefinition).moduleId === 'string'
    && typeof (value as TableDefinition).tableName === 'string'
    && Array.isArray((value as TableDefinition).columns);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizePostgresType(value: unknown) {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case 'uuid':
      return 'UUID';
    case 'text':
      return 'TEXT';
    case 'int':
    case 'integer':
      return 'INTEGER';
    case 'decimal':
    case 'numeric':
      return 'NUMERIC';
    case 'timestamptz':
      return 'TIMESTAMPTZ';
    case 'bool':
    case 'boolean':
      return 'BOOLEAN';
    case 'json':
    case 'jsonb':
      return 'JSONB';
    default:
      return normalized?.toUpperCase() ?? 'TEXT';
  }
}

function normalizeDefaultSql(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/gu, "''")}'`;
  }
  return undefined;
}

function normalizePlannerTableDefinition(value: unknown): TableDefinition | null {
  if (!isRecord(value)) {
    return null;
  }

  const moduleId = readString(value.moduleId);
  const tableName = readString(value.tableName);
  const rawColumns = Array.isArray(value.columns) ? value.columns.filter(isRecord) : [];
  if (!moduleId || !tableName || rawColumns.length === 0) {
    return null;
  }

  const columns: TableDefinition['columns'] = [];
  for (const column of rawColumns) {
    const name = readString(column.name);
    if (!name) {
      continue;
    }
    const normalizedColumn: TableDefinition['columns'][number] = {
      name,
      postgresType: normalizePostgresType(column.type),
    };
    if (typeof column.nullable === 'boolean') {
      normalizedColumn.nullable = column.nullable;
    }
    const defaultSql = normalizeDefaultSql(column.default);
    if (defaultSql) {
      normalizedColumn.defaultSql = defaultSql;
    }
    const description = readString(column.description);
    if (description) {
      normalizedColumn.description = description;
    }
    columns.push(normalizedColumn);
  }

  const explicitPrimaryKey = readStringArray(value.primaryKey);
  const primaryKey = explicitPrimaryKey.length > 0
    ? explicitPrimaryKey
    : rawColumns
      .filter((column) => column.primaryKey === true)
      .map((column) => readString(column.name))
      .filter((name): name is string => !!name);

  const indexes = Array.isArray(value.indexes)
    ? value.indexes
      .filter(isRecord)
      .map((index) => ({
        name: readString(index.indexName) ?? readString(index.name) ?? `idx_${tableName}`,
        columns: readStringArray(index.columns),
      }))
      .filter((index) => index.columns.length > 0)
    : undefined;

  return {
    moduleId,
    repositoryName: readString(value.tableId),
    tableName,
    purpose: 'transacao',
    description: readString(value.purpose) ?? readString(value.title) ?? tableName,
    backupHot: false,
    storageProfile: 'postgres',
    writeMode: 'sync',
    columns,
    primaryKey,
    indexes,
    version: 1,
  };
}

function normalizeTableDefinition(value: unknown): TableDefinition | null {
  if (isTableDefinition(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }

  const data = isRecord(value.data) ? value.data : null;
  return normalizePlannerTableDefinition(data?.tableDefinition);
}

function isTableSeedRows(value: unknown): value is TableSeedRows {
  return !!value
    && typeof value === 'object'
    && typeof (value as TableSeedRows).seedFor === 'string'
    && Array.isArray((value as TableSeedRows).rows);
}

// Hexagonal model: discover every TableDefinition-shaped export across the module's table-def
// adapters. TableSeedRows-shaped exports are collected globally and merged after every persistence
// module is loaded, so a client module can seed 102034-owned MDM tables without owning them.
async function discoverTableDefinitions(tableDefsDir: string): Promise<ImportedPersistenceDefinitions> {
  const dir = resolveProjectDistPath(tableDefsDir);
  const definitions: TableDefinition[] = [];
  const seeds: TableSeedRows[] = [];
  const files = readdirSync(dir).filter((file) =>
    (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts'));
  for (const file of files) {
    const moduleUrl = resolveProjectModuleImportUrl(`${tableDefsDir.replace(/\/$/u, '')}/${file}`);
    const mod = await import(moduleUrl);
    const seenExports = new Set<unknown>();
    for (const value of Object.values(mod)) {
      if (isRecord(value)) {
        if (seenExports.has(value)) {
          continue;
        }
        seenExports.add(value);
      }
      const definition = normalizeTableDefinition(value);
      if (definition) {
        definitions.push(definition);
      } else if (isTableSeedRows(value)) {
        seeds.push(value);
      }
    }
  }
  return { definitions, seeds, seedSource: tableDefsDir };
}

async function importTableDefinitions(
  registration: PersistenceModuleRegistration,
): Promise<ImportedPersistenceDefinitions> {
  if (registration.tableDefsDir) {
    return discoverTableDefinitions(registration.tableDefsDir);
  }
  if (!registration.persistenceEntrypoint) {
    throw new AppError(
      'PERSISTENCE_MANIFEST_INVALID',
      'Persistence module must declare persistenceEntrypoint or tableDefsDir',
      500,
      registration,
    );
  }
  const moduleUrl = resolveProjectModuleImportUrl(registration.persistenceEntrypoint);
  const mod = await import(moduleUrl);
  const seeds = Object.values(mod).filter(isTableSeedRows);
  const directExport = mod.tableDefinitions;
  if (Array.isArray(directExport)) {
    return {
      definitions: directExport
        .map(normalizeTableDefinition)
        .filter((definition): definition is TableDefinition => definition !== null),
      seeds,
      seedSource: registration.persistenceEntrypoint,
    };
  }

  if (typeof mod.getTableDefinitions === 'function') {
    const loaded = await mod.getTableDefinitions();
    if (Array.isArray(loaded)) {
      return { definitions: loaded as TableDefinition[], seeds, seedSource: registration.persistenceEntrypoint };
    }
  }

  throw new AppError(
    'PERSISTENCE_MANIFEST_INVALID',
    'Persistence manifest must export tableDefinitions',
    500,
    registration,
  );
}

function applySeedRows(
  definitions: ResolvedTableDefinition[],
  seeds: Array<{ seed: TableSeedRows; source: string }>,
) {
  for (const { seed, source } of seeds) {
    // Seeds target the logical name (repositoryName like 'cafeFlowOrder', or the base table name
    // 'order'); the physical tableName is namespaced, so match logicalTableName too.
    const def = definitions.find((d) =>
      d.repositoryName === seed.seedFor || d.logicalTableName === seed.seedFor || d.tableName === seed.seedFor);
    if (def) {
      def.seedRows = [...(def.seedRows ?? []), ...seed.rows];
    } else {
      console.warn(`[persistence] seed target not found in ${source}: ${seed.seedFor}`);
    }
  }
}

function validateDefinition(
  definition: TableDefinition,
  registration: PersistenceModuleRegistration,
  env: Pick<AppEnv, 'appEnv'>,
) {
  if (definition.moduleId !== registration.moduleId) {
    throw new AppError(
      'PERSISTENCE_MANIFEST_INVALID',
      'Persistence definition moduleId mismatch',
      500,
      {
        expectedModuleId: registration.moduleId,
        receivedModuleId: definition.moduleId,
        tableName: definition.tableName,
      },
    );
  }

  if (definition.columns.length === 0) {
    throw new AppError(
      'PERSISTENCE_MANIFEST_INVALID',
      'Persistence definition must declare columns',
      500,
      {
        moduleId: definition.moduleId,
        tableName: definition.tableName,
      },
    );
  }

  if (definition.primaryKey.length === 0 && definition.storageProfile !== 'dynamoOnly') {
    throw new AppError(
      'PERSISTENCE_MANIFEST_INVALID',
      'Postgres-backed tables must declare a primary key',
      500,
      {
        moduleId: definition.moduleId,
        tableName: definition.tableName,
      },
    );
  }

  if (usesDynamo(definition) && !resolveDynamoTableName(definition, env)) {
    throw new AppError(
      'PERSISTENCE_MANIFEST_INVALID',
      'Dynamo-backed tables must declare a DynamoDB table name',
      500,
      {
        moduleId: definition.moduleId,
        tableName: definition.tableName,
      },
    );
  }
}

function validateResolvedDefinitions(definitions: ResolvedTableDefinition[]) {
  const seenTableNames = new Map<string, ResolvedTableDefinition>();
  const seenRepositoryNames = new Map<string, ResolvedTableDefinition>();
  const seenDynamoNames = new Map<string, ResolvedTableDefinition>();

  for (const definition of definitions) {
    const tableKey = definition.tableName;
    const previousTable = seenTableNames.get(tableKey);
    if (previousTable) {
      throw new AppError(
        'PERSISTENCE_MANIFEST_DUPLICATE',
        'Duplicate table name found in persistence registry',
        500,
        { current: definition, previous: previousTable },
      );
    }
    seenTableNames.set(tableKey, definition);

    const repositoryKey = definition.repositoryName;
    const previousRepository = seenRepositoryNames.get(repositoryKey);
    if (previousRepository) {
      throw new AppError(
        'PERSISTENCE_MANIFEST_DUPLICATE',
        'Duplicate repository name found in persistence registry',
        500,
        { current: definition, previous: previousRepository },
      );
    }
    seenRepositoryNames.set(repositoryKey, definition);

    if (usesDynamo(definition) && definition.dynamoResolvedTableName) {
      const previousDynamo = seenDynamoNames.get(definition.dynamoResolvedTableName);
      if (previousDynamo) {
        throw new AppError(
          'PERSISTENCE_MANIFEST_DUPLICATE',
          'Duplicate DynamoDB table name found in persistence registry',
          500,
          { current: definition, previous: previousDynamo },
        );
      }
      seenDynamoNames.set(definition.dynamoResolvedTableName, definition);
    }
  }
}

export async function loadResolvedTableDefinitions(
  env: Pick<AppEnv, 'appEnv'>,
): Promise<ResolvedTableDefinition[]> {
  const cached = registryCache.get(env.appEnv);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const registrations = getPersistenceModuleRegistrations();
    const imported = await Promise.all(registrations.map(async (registration) => {
      const loaded = await importTableDefinitions(registration);
      const definitions = loaded.definitions.map((definition): ResolvedTableDefinition => {
        validateDefinition(definition, registration, env);
        const logicalTableName = resolvePostgresTableName(definition, env);
        const dynamoBaseName = resolveDynamoTableName(definition, env);
        return {
          ...definition,
          logicalTableName,
          tableName: applyProjectTableNamespace(logicalTableName, registration.projectId, registration.projectType),
          projectId: registration.projectId,
          repositoryName: resolveRepositoryName(definition),
          dynamoResolvedTableName: dynamoBaseName
            ? applyProjectTableNamespace(dynamoBaseName, registration.projectId, registration.projectType)
            : null,
        };
      });
      return {
        definitions,
        seeds: loaded.seeds.map((seed) => ({ seed, source: loaded.seedSource })),
      };
    }));

    const flattened = imported.flatMap((item) => item.definitions).sort((left, right) =>
      `${left.projectId}:${left.moduleId}:${left.tableName}`.localeCompare(
        `${right.projectId}:${right.moduleId}:${right.tableName}`,
      ),
    );
    applySeedRows(flattened, imported.flatMap((item) => item.seeds));
    validateResolvedDefinitions(flattened);
    return flattened;
  })();

  registryCache.set(env.appEnv, pending);
  return pending;
}

export function resetResolvedTableDefinitionsCache() {
  registryCache.clear();
}

export async function loadResolvedPostgresTableDefinitions(
  env: Pick<AppEnv, 'appEnv'>,
): Promise<ResolvedTableDefinition[]> {
  const definitions = await loadResolvedTableDefinitions(env);
  return definitions.filter((definition) => usesPostgres(definition));
}

export async function loadResolvedDynamoTableDefinitions(
  env: Pick<AppEnv, 'appEnv'>,
): Promise<ResolvedTableDefinition[]> {
  const definitions = await loadResolvedTableDefinitions(env);
  return definitions.filter((definition) => usesDynamo(definition));
}

export async function buildSchemaSnapshot(
  env: Pick<AppEnv, 'appEnv'>,
): Promise<SchemaSnapshot> {
  const definitions = await loadResolvedTableDefinitions(env);
  const tables = definitions.map((definition) => ({
    projectId: definition.projectId,
    moduleId: definition.moduleId,
    repositoryName: definition.repositoryName,
    tableName: definition.tableName,
    storageProfile: definition.storageProfile,
    backupHot: definition.backupHot,
    dynamoTableName: definition.dynamoResolvedTableName,
    version: definition.version,
  }));
  const hash = await sha256Hex(JSON.stringify(tables));
  const appliedAt = new Date().toISOString();

  return {
    id: `registry:${hash}`,
    hash,
    appliedAt,
    tables,
  };
}

export async function loadViewDefinitions(): Promise<ViewDefinition[]> {
  const registrations = getPersistenceModuleRegistrations();
  const results = await Promise.all(registrations.map(async (registration) => {
    if (!registration.persistenceEntrypoint) {
      return [] as ViewDefinition[];
    }
    const moduleUrl = resolveProjectModuleImportUrl(registration.persistenceEntrypoint);
    const mod = await import(moduleUrl);
    const exported = mod.viewDefinitions;
    if (!Array.isArray(exported)) {
      return [] as ViewDefinition[];
    }
    return exported as ViewDefinition[];
  }));
  return results.flat();
}

export async function findResolvedTableDefinition(
  repositoryNameOrTableName: string,
  env: Pick<AppEnv, 'appEnv'>,
): Promise<ResolvedTableDefinition> {
  const definitions = await loadResolvedTableDefinitions(env);
  const definition = definitions.find((entry) =>
    entry.repositoryName === repositoryNameOrTableName ||
    entry.logicalTableName === repositoryNameOrTableName ||
    entry.tableName === repositoryNameOrTableName,
  );
  if (!definition) {
    throw new AppError(
      'PERSISTENCE_TABLE_NOT_FOUND',
      'Persistence table is not registered',
      404,
      { repositoryNameOrTableName },
    );
  }
  return definition;
}
