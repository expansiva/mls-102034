/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftCopy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { draftDirOf } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { readDraftData } from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import {
  draftCopyTables,
  performDraftCopy,
  type DraftCopyColumn,
  type PerformDraftCopyInput,
} from '/_102034_/l1/server/layer_1_external/cbe/draftCopy.js';
import {
  copyDraftLogin,
  forgetDraftLoginCopy,
  type DraftLoginLoaded,
  type Sql,
} from '/_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.js';
import { draftCopyHooks, draftDataHooks, draftDbHooks, draftDevHooks, draftPrepareHooks, registerCbeRoutes, sessionHooks } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const PARENT_TEST_URL = 'postgres://collab:s3cret@127.0.0.1:5432/collab_app_test';
const CATALOG = [
  'mls102047_cafeflow_cup',
  'mls102047_orders_item',
  'mls999_orders_item',
  'mdm_documents',
  'mdm_documents_entities_index',
  'mdm_tag',
  'mdm_relationship',
  'mdm_kv',
  'mdm_outbox',
  'mdm_audit_log',
  'mdm_monitoring_write',
  'monitor_bff_execution_log',
  '_schema_module_state',
  'platform_schema_snapshot_log',
  'platform_workflow_projection_tasks',
];
const ALL = [
  'mdm_documents',
  'mdm_documents_entities_index',
  'mdm_relationship',
  'mdm_tag',
  'mls102047_cafeflow_cup',
  'mls102047_orders_item',
];
const COLUMNS: DraftCopyColumn[] = [
  { name: 'id', type: 'text' },
  { name: 'details', type: 'jsonb' },
];

function loaded(): DraftLoginLoaded {
  const person = {
    mdmId: 'person-1',
    subtype: 'Person',
    name: 'Ada',
    status: 'Active',
    docType: null,
    docId: null,
    countryCode: 'BR',
    tags: [] as string[],
    searchVector: '',
    mergedInto: null,
    dynamoPk: 'person-1',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
  return {
    email: 'ada@example.com',
    login: {
      id: 'tag-1',
      entityType: 'MdmEntity',
      entityId: 'person-1',
      tag: 'ada@example.com',
      namespace: 'login',
      module: 'organization',
      createdBy: 'app',
      createdByType: 'system',
      createdAt: '2026-11-11T00:00:00.000Z',
    },
    indexes: new Map([['person-1', person]]),
    documents: new Map([['person-1', { mdmId: 'person-1', version: 1, details: { name: 'Ada' } }]]),
    relationships: [],
    sourceReservations: [],
    draftReservations: [],
    draftIndexIds: new Set(),
  };
}

const bomb: Sql = {
  async query() {
    throw new Error('sql should not run');
  },
};

test('draftCopyTables: all, one module, registry flag, and the excluded tables', () => {
  assert.deepEqual(draftCopyTables({ projectId: PROJECT_ID, tables: CATALOG }), ALL);
  assert.deepEqual(
    draftCopyTables({ projectId: PROJECT_ID, tables: CATALOG, modules: ['cafeFlow'] }),
    ['mls102047_cafeflow_cup'],
  );
  assert.deepEqual(
    draftCopyTables({ projectId: PROJECT_ID, tables: CATALOG, modules: ['cafeFlow'], withRegistry: false }),
    ['mls102047_cafeflow_cup'],
  );
  assert.deepEqual(
    draftCopyTables({ projectId: PROJECT_ID, tables: CATALOG, modules: ['orders'], withRegistry: true }),
    ['mdm_documents', 'mdm_documents_entities_index', 'mdm_relationship', 'mdm_tag', 'mls102047_orders_item'],
  );
  const excluded = ['mdm_outbox', 'mdm_audit_log', 'mdm_monitoring_write', 'monitor_bff_execution_log', '_schema_module_state', 'platform_schema_snapshot_log', 'mdm_kv'];
  const all = draftCopyTables({ projectId: PROJECT_ID, tables: CATALOG });
  for (const name of excluded) assert.equal(all.includes(name), false, name);
});

test('draftCopy requires copy authority, records the copy, forgets the login, and stops before copying', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-copy-'));
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    login: process.env.CBE_REQUIRE_LOGIN,
    testDatabase: process.env.DATABASE_URL_TEST,
    database: process.env.DATABASE_URL,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REQUIRE_LOGIN = 'never';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  process.env.DATABASE_URL = PARENT_TEST_URL;
  const orig = {
    alpha: draftDataHooks.alphaOn,
    authorities: draftDataHooks.authoritiesOf,
    email: sessionHooks.emailOf,
    drop: draftDbHooks.dropDatabase,
    stop: draftDevHooks.stopDevProcess,
    ensure: draftDevHooks.ensureDevProcess,
    prepare: draftPrepareHooks.awaitDraftPrepare,
    perform: draftCopyHooks.perform,
  };
  const order: string[] = [];
  const spawned: string[][] = [];
  let authorities: readonly string[] = [];
  let truncate = '';
  let mismatch = false;
  draftDataHooks.alphaOn = () => false;
  draftDataHooks.authoritiesOf = async () => authorities;
  sessionHooks.emailOf = async () => 'ana@x.com';
  draftDbHooks.dropDatabase = async (_admin, name) => {
    order.push(`drop:${name}`);
  };
  draftPrepareHooks.awaitDraftPrepare = async () => {
    order.push('prepare');
  };
  draftDevHooks.stopDevProcess = () => {
    order.push('stop');
  };
  draftDevHooks.ensureDevProcess = () => {
    order.push('start');
    return { port: 1, pid: 1, startedAt: 0, lastRequestAt: 0, database: 'collab_app_draft_team_102047', codeId: 'test' };
  };
  const io = {
    tables: async () => {
      order.push('copy');
      return CATALOG;
    },
    columns: async (url: string) => (
      mismatch && url === PARENT_TEST_URL ? [...COLUMNS, { name: 'note', type: 'text' }] : COLUMNS
    ),
    query: async (_url: string, text: string) => {
      truncate = text;
    },
    spawn: async (command: string, args: string[]) => {
      spawned.push([command, ...args]);
      if (command === 'pg_dump' && args.includes('mdm_outbox')) return { code: 1, stderr: 'postgres://collab:s3cret@127.0.0.1/db' };
      return { code: 0, stderr: '' };
    },
  };
  draftCopyHooks.perform = (input: PerformDraftCopyInput) => performDraftCopy({ ...input, io });
  const app = Fastify();
  registerCbeRoutes(app);
  const dir = draftDirOf(base, SLUG);
  let loads = 0;
  const login = (generation: string) => copyDraftLogin({
    sourceName: 'seed',
    email: 'ada@example.com',
    draftKey: dir,
    generation,
    from: bomb,
    to: bomb,
    load: async () => {
      loads += 1;
      return loaded();
    },
    write: async () => {},
  });
  try {
    const denied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftCopy', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json().code, 'DRAFT_DATA_FORBIDDEN');
    assert.equal(order.length, 0);

    authorities = ['draftData.copy'];
    const bad = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { 'accept-language': 'pt' },
      payload: { action: 'draftCopy', project: PROJECT_ID, draft: SLUG, modules: [] },
    });
    assert.equal(bad.statusCode, 400, bad.body);
    assert.match(bad.json().msg, /módulos/);
    assert.equal(order.length, 0);

    await login('before');
    assert.equal(loads, 1);
    const copied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftCopy', project: PROJECT_ID, draft: SLUG, modules: ['orders'] },
    });
    assert.equal(copied.statusCode, 200, copied.body);
    assert.deepEqual(copied.json().tables, ['mls102047_orders_item']);
    assert.deepEqual(order, ['prepare', 'stop', 'copy', 'start']);
    assert.match(truncate, /TRUNCATE TABLE "mls102047_orders_item"/u);
    assert.equal(truncate.includes('mdm_documents'), false);
    const dump = spawned.find((args) => args[0] === 'pg_dump');
    assert.ok(dump);
    assert.equal(dump.includes('--table'), true);
    assert.equal(dump.includes('mls102047_orders_item'), true);
    assert.equal(dump.includes('mdm_outbox'), false);
    assert.equal(dump.includes('s3cret'), false);
    const stored = readDraftData(dir);
    assert.equal(stored.source, 'copy');
    assert.equal(stored.by, 'ana@x.com');
    assert.deepEqual(stored.modules, ['orders']);
    assert.equal(stored.withRegistry, false);
    const log = readFileSync(join(dir, 'data.log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { action: string; result: string; source: string });
    assert.equal(log.at(-1)?.action, 'copy');
    assert.equal(log.at(-1)?.result, 'ok');
    assert.equal(log.at(-1)?.source, 'copy');
    await login('before');
    assert.equal(loads, 2);

    order.length = 0;
    spawned.length = 0;
    mismatch = true;
    const mismatched = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftCopy', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(mismatched.statusCode, 500, mismatched.body);
    assert.equal(mismatched.json().table, 'mdm_documents');
    assert.match(mismatched.json().msg, /columns do not match/);
    assert.equal(mismatched.json().msg.includes('s3cret'), false);
    assert.equal(mismatched.json().source, 'seed');
    assert.equal(readDraftData(dir).source, 'seed');
    assert.equal(order.includes('drop:collab_app_draft_team_102047'), true);
    assert.deepEqual(order.slice(0, 3), ['prepare', 'stop', 'copy']);
    assert.equal(order.at(-1), 'start');
    const failed = readFileSync(join(dir, 'data.log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { result: string; source: string; cause: string });
    assert.equal(failed.at(-1)?.result, 'failed');
    assert.equal(failed.at(-1)?.source, 'seed');
    assert.match(failed.at(-1)?.cause ?? '', /mdm_documents/);
    await login('before');
    assert.equal(loads, 3);
  } finally {
    forgetDraftLoginCopy(dir);
    draftDataHooks.alphaOn = orig.alpha;
    draftDataHooks.authoritiesOf = orig.authorities;
    sessionHooks.emailOf = orig.email;
    draftDbHooks.dropDatabase = orig.drop;
    draftDevHooks.stopDevProcess = orig.stop;
    draftDevHooks.ensureDevProcess = orig.ensure;
    draftPrepareHooks.awaitDraftPrepare = orig.prepare;
    draftCopyHooks.perform = orig.perform;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    if (prev.testDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prev.testDatabase;
    if (prev.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev.database;
    rmSync(base, { recursive: true, force: true });
  }
});
