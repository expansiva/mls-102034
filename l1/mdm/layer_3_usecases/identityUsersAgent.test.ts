/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsersAgent.test.ts" enhancement="_blank" />
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { ensureAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';
import { listUsers } from '/_102034_/l1/mdm/layer_3_usecases/identityUsers.js';

/** The list of people shows the member-agent (`kind: 'agent'`, no e-mail) next to the people with login; a person with neither stays out. */
async function scenario(ctx: RequestContext): Promise<void> {
  const ana = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ana Pessoa', status: 'Active' } });
  await ctx.mdm.identity.setLogin(ana.mdmId, 'ana.pessoa@example.test');
  const loose = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: 'Ana Solta', status: 'Active' } });
  const robot = await ensureAgentMember(ctx, { agentId: 'agent-list-on', name: 'Ana Robo', active: true });
  const idle = await ensureAgentMember(ctx, { agentId: 'agent-list-off', name: 'Ana Parado', active: false });

  const active = await listUsers(ctx, { name: 'ana', pageSize: 100 });
  const byId = new Map(active.items.map((item) => [item.mdmId, item]));
  assert.equal(byId.get(ana.mdmId)?.kind, 'person');
  assert.equal(byId.get(ana.mdmId)?.loginEmail, 'ana.pessoa@example.test');
  assert.equal(byId.get(robot.mdmId)?.kind, 'agent');
  assert.equal(byId.get(robot.mdmId)?.loginEmail, '');
  assert.equal(byId.get(robot.mdmId)?.status, 'Active');
  assert.equal(byId.has(idle.mdmId), false, 'the inactive agent is out of the default (Active) list');
  assert.equal(byId.has(loose.mdmId), false, 'a person with no login and no agent link stays out');

  const inactive = await listUsers(ctx, { name: 'ana', status: 'Inactive', pageSize: 100 });
  assert.deepEqual(inactive.items.map((item) => [item.mdmId, item.kind, item.loginEmail, item.status]), [[idle.mdmId, 'agent', '', 'Inactive']]);

  const byName = await listUsers(ctx, { name: 'robo', pageSize: 100 });
  assert.deepEqual(byName.items.map((item) => item.mdmId), [robot.mdmId]);

  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await listUsers(ctx, { name: 'ana', status: 'all', pageSize: 2, ...(cursor ? { cursor } : {}) });
    paged.push(...page.items.map((item) => item.mdmId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual([...paged].sort(), [ana.mdmId, robot.mdmId, idle.mdmId].sort());
}

test('memory: the list of people shows the member-agent with kind agent and no e-mail', async () => {
  await scenario(createRequestContext(createMemoryDataRuntime()));
});

const integration = process.env.RUN_INTEGRATION_TESTS === 'true' && (process.env.WORKFLOW_TEST_PG_URL ?? '') !== '';
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

test('real Postgres: the list of people shows the member-agent with kind agent and no e-mail', { skip: !integration, timeout: 60_000 }, async () => {
  const url = new URL(process.env.WORKFLOW_TEST_PG_URL ?? '');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || decodeURIComponent(url.pathname.replace(/^\//u, '')) !== 'collab_app_test') {
    throw new Error('WORKFLOW_TEST_PG_URL must be a local collab_app_test URL');
  }
  schema = `agent_users_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('options', `-c search_path=${schema}`);
  pool = new Pool({ connectionString: url.toString(), max: 4 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const definition of tableDefinitions) {
      const resolved = { ...definition, projectId: 'agent-users', repositoryName: definition.repositoryName ?? definition.tableName, logicalTableName: definition.tableName, dynamoResolvedTableName: null };
      await client.query(buildCreateTableSql(resolved));
      for (const sql of buildCreateIndexSql(resolved)) await client.query(sql);
    }
  } finally {
    client.release();
  }
  await scenario(createRequestContext(createPostgresDataRuntime({ appEnv: 'development' } as AppEnv, pool)));
});
