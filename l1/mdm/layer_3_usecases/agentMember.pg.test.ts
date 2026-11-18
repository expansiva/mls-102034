/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/agentMember.pg.test.ts" enhancement="_blank" />
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { ensureAgentMember, findAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';

/** Real Postgres, in a schema of its own inside the local test database (a tunnel to it), dropped at the end. */
const integration = process.env.RUN_INTEGRATION_TESTS === 'true' && (process.env.WORKFLOW_TEST_PG_URL ?? '') !== '';

function localTestUrl(): string {
  const raw = process.env.WORKFLOW_TEST_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || database !== 'collab_app_test') {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  return raw;
}

let pool: Pool | undefined;
let schema = '';

after(async () => {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  try {
    await closing.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await closing.end();
  }
});

test('real Postgres: the member of an agent is created, read back, repeated, renamed and inactivated without a second member', { skip: !integration, timeout: 60_000 }, async () => {
  schema = `agent_member_${randomBytes(8).toString('hex')}`;
  const url = new URL(localTestUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  pool = new Pool({ connectionString: url.toString(), max: 4 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const definition of tableDefinitions) {
      const resolved = { ...definition, projectId: 'agent-member', repositoryName: definition.repositoryName ?? definition.tableName, logicalTableName: definition.tableName, dynamoResolvedTableName: null };
      await client.query(buildCreateTableSql(resolved));
      for (const sql of buildCreateIndexSql(resolved)) await client.query(sql);
    }
  } finally {
    client.release();
  }

  const ctx = createRequestContext(createPostgresDataRuntime({ appEnv: 'development' } as AppEnv, pool));
  assert.equal(await findAgentMember(ctx, 'agent-pg'), null);
  const created = await ensureAgentMember(ctx, { agentId: 'agent-pg', name: 'Ana', active: true });
  assert.deepEqual(await findAgentMember(ctx, 'agent-pg'), created);
  assert.equal((await ensureAgentMember(ctx, { agentId: 'agent-pg', name: 'Ana', active: true })).mdmId, created.mdmId);

  const renamed = await ensureAgentMember(ctx, { agentId: 'agent-pg', name: 'Ana Maria', active: false });
  assert.deepEqual(renamed, { mdmId: created.mdmId, name: 'Ana Maria', active: false });
  assert.deepEqual(await findAgentMember(ctx, 'agent-pg'), renamed);

  const results = await Promise.all(Array.from({ length: 8 }, () => ensureAgentMember(ctx, { agentId: 'agent-pg-race', name: 'Rui', active: true })));
  assert.equal(new Set(results.map((member) => member.mdmId)).size, 1);

  const rows = await pool.query(`SELECT tag, namespace FROM "mdm_tag" WHERE namespace = 'agent' ORDER BY tag`);
  assert.deepEqual(rows.rows, [{ tag: 'agent-pg', namespace: 'agent' }, { tag: 'agent-pg-race', namespace: 'agent' }]);
  const people = await pool.query(`SELECT count(*)::int AS n FROM "mdm_documents_entities_index" WHERE subtype = 'Person'`);
  assert.equal(people.rows[0]?.n, 2);
});
