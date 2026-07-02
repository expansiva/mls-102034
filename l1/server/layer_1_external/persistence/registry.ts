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
  moduleId: string;
  persistenceEntrypoint?: string;
  tableDefsDir?: string;
}

const registryCache = new Map<AppEnv['appEnv'], Promise<ResolvedTableDefinition[]>>();

function getPersistenceModuleRegistrations(): PersistenceModuleRegistration[] {
  const config = readProjectsConfig();
  return Object.entries(config.projects).flatMap(([projectId, project]) =>
    (project.persistenceModules ?? []).map((moduleConfig: ProjectPersistenceModuleConfig) => ({
      projectId,
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

function isTableSeedRows(value: unknown): value is TableSeedRows {
  return !!value
    && typeof value === 'object'
    && typeof (value as TableSeedRows).seedFor === 'string'
    && Array.isArray((value as TableSeedRows).rows);
}

// Hexagonal model: discover every TableDefinition-shaped export across the module's table-def
// adapters. TableSeedRows-shaped exports (separate seeds file) are merged into the matching
// definition's seedRows, keeping the generated table definitions untouched.
async function discoverTableDefinitions(tableDefsDir: string): Promise<TableDefinition[]> {
  const dir = resolveProjectDistPath(tableDefsDir);
  const defs: TableDefinition[] = [];
  const seeds: TableSeedRows[] = [];
  const files = readdirSync(dir).filter((file) => file.endsWith('.js') && !file.endsWith('.defs.js'));
  for (const file of files) {
    const moduleUrl = resolveProjectModuleImportUrl(`${tableDefsDir.replace(/\/$/u, '')}/${file}`);
    const mod = await import(moduleUrl);
    for (const value of Object.values(mod)) {
      if (isTableDefinition(value)) {
        defs.push(value);
      } else if (isTableSeedRows(value)) {
        seeds.push(value);
      }
    }
  }
  for (const seed of seeds) {
    const def = defs.find((d) => d.repositoryName === seed.seedFor || d.tableName === seed.seedFor);
    if (def) {
      def.seedRows = [...(def.seedRows ?? []), ...seed.rows];
    } else {
      console.warn(`[persistence] seed target not found in ${tableDefsDir}: ${seed.seedFor}`);
    }
  }
  return defs;
}

async function importTableDefinitions(
  registration: PersistenceModuleRegistration,
): Promise<TableDefinition[]> {
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
  const directExport = mod.tableDefinitions;
  if (Array.isArray(directExport)) {
    return directExport as TableDefinition[];
  }

  if (typeof mod.getTableDefinitions === 'function') {
    const loaded = await mod.getTableDefinitions();
    if (Array.isArray(loaded)) {
      return loaded as TableDefinition[];
    }
  }

  throw new AppError(
    'PERSISTENCE_MANIFEST_INVALID',
    'Persistence manifest must export tableDefinitions',
    500,
    registration,
  );
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
    const definitions = await Promise.all(registrations.map(async (registration) => {
      const loaded = await importTableDefinitions(registration);
      return loaded.map((definition): ResolvedTableDefinition => {
        validateDefinition(definition, registration, env);
        return {
          ...definition,
          tableName: resolvePostgresTableName(definition, env),
          projectId: registration.projectId,
          repositoryName: resolveRepositoryName(definition),
          dynamoResolvedTableName: resolveDynamoTableName(definition, env),
        };
      });
    }));

    const flattened = definitions.flat().sort((left, right) =>
      `${left.projectId}:${left.moduleId}:${left.tableName}`.localeCompare(
        `${right.projectId}:${right.moduleId}:${right.tableName}`,
      ),
    );
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
