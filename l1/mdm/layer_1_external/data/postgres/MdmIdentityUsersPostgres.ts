/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/postgres/MdmIdentityUsersPostgres.ts" enhancement="_blank" />
import type { Pool, PoolClient } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type {
  MdmIdentityUserReader,
  MdmUserDirectoryQuery,
  MdmUserDirectoryRow,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';
import { getMdmTableNames } from '/_102034_/l1/mdm/tableNames.js';
import { queryRows } from '/_102034_/l1/mdm/layer_1_external/data/postgres/pg.js';

type PgExecutor = Pool | PoolClient;

const LOGIN_ENTITY_TYPE = 'MdmEntity';
const LOGIN_NAMESPACE = 'login';
const LOGIN_MODULE = 'organization';
const PERSON_SUBTYPE = 'Person';

const FOLDED_NAME_SQL = `lower(regexp_replace(normalize(coalesce(idx."name", ''), NFD), U&'[\\0300-\\036f]', '', 'g'))`;

export interface MdmIdentityUsersPageSql {
  sql: string;
  params: unknown[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * One page over the person index. Filters run before afterMdmId and LIMIT.
 * Table names come only from getMdmTableNames. Values and the limit are parameters.
 */
export function buildIdentityUsersPageSql(appEnv: AppEnv['appEnv'], query: MdmUserDirectoryQuery): MdmIdentityUsersPageSql {
  const tables = getMdmTableNames(appEnv);
  const index = quoteIdentifier(tables.documentsEntitiesIndex);
  const documents = quoteIdentifier(tables.documents);
  const tag = quoteIdentifier(tables.tag);
  const params: unknown[] = [];
  const filters: string[] = [
    `idx."subtype" = '${PERSON_SUBTYPE}'`,
    `EXISTS (
      SELECT 1 FROM ${tag} canon
      WHERE canon."entityType" = '${LOGIN_ENTITY_TYPE}'
        AND canon."namespace" = '${LOGIN_NAMESPACE}'
        AND canon."module" = '${LOGIN_MODULE}'
        AND canon."entityId" = idx."mdmId"
    )`,
  ];

  if (query.foldedName !== null) {
    params.push(query.foldedName);
    filters.push(`position($${params.length} in ${FOLDED_NAME_SQL}) > 0`);
  }
  if (query.status !== 'all') {
    params.push(query.status);
    filters.push(`idx."status" = $${params.length}`);
  }
  if (query.roleTag !== null) {
    params.push(query.roleTag);
    const membership = `$${params.length} = ANY(COALESCE(idx."tags", '{}'::text[]))`;
    filters.push(query.roleTagMode === 'without' ? `NOT (${membership})` : membership);
  }
  if (query.afterMdmId !== null) {
    params.push(query.afterMdmId);
    filters.push(`idx."mdmId" COLLATE "C" > $${params.length}`);
  }
  params.push(query.limit);
  const limitParam = params.length;

  const sql = `SELECT
  idx."mdmId" AS "mdmId",
  idx."name" AS "name",
  idx."status" AS "status",
  COALESCE(idx."tags", '{}'::text[]) AS "tags",
  doc."version" AS "version",
  doc."mdmId" AS "documentMdmId",
  doc."details"->>'subtype' AS "documentSubtype",
  doc."details"->'contacts' AS "contacts",
  COALESCE((
    SELECT array_agg(tag."tag")
    FROM ${tag} tag
    WHERE tag."entityType" = '${LOGIN_ENTITY_TYPE}'
      AND tag."namespace" = '${LOGIN_NAMESPACE}'
      AND tag."module" = '${LOGIN_MODULE}'
      AND tag."entityId" = idx."mdmId"
  ), '{}'::text[]) AS "loginTags"
FROM ${index} idx
LEFT JOIN ${documents} doc ON doc."mdmId" = idx."mdmId"
WHERE ${filters.join('\n  AND ')}
ORDER BY idx."mdmId" COLLATE "C" ASC
LIMIT $${limitParam}`;

  return { sql, params };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function mapRow(raw: Record<string, unknown>): MdmUserDirectoryRow {
  const version = raw.version;
  return {
    mdmId: String(raw.mdmId ?? ''),
    name: raw.name == null ? '' : String(raw.name),
    status: raw.status as MdmUserDirectoryRow['status'],
    tags: asStringArray(raw.tags),
    version: version == null ? null : Number(version),
    documentMdmId: raw.documentMdmId == null ? null : String(raw.documentMdmId),
    documentSubtype: raw.documentSubtype == null ? null : String(raw.documentSubtype),
    contacts: raw.contacts ?? null,
    loginTags: asStringArray(raw.loginTags),
  };
}

export function createPostgresMdmIdentityUsersReader(env: AppEnv, executor: PgExecutor): MdmIdentityUserReader {
  return {
    async listPage(query: MdmUserDirectoryQuery): Promise<MdmUserDirectoryRow[]> {
      const page = buildIdentityUsersPageSql(env.appEnv, query);
      const rows = await queryRows<Record<string, unknown>>(executor, page.sql, page.params);
      return rows.map(mapRow);
    },
  };
}
