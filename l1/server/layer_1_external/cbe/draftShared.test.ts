/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftShared.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  DraftDatabaseError,
  draftChildDatabaseUrls,
  draftDatabaseUrl,
  draftDirOf,
  ensureDevProcess,
  type DevSpawn,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { readDraftData } from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import { draftDataHooks, draftDbHooks, draftDevHooks, draftCopyHooks, draftPrepareHooks, registerCbeRoutes, sessionHooks } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import { sharedDraftDrift, sharedDraftSchemaMessage, sharedDraftSchemaModules } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import { createRequestContext, execBff, refuseDraftReadonlyWrite } from '/_102034_/l1/server/layer_2_controllers/execBff.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const PARENT = 'postgres://collab:s3cret@127.0.0.1:5432/collab_app_test';
const READONLY = 'postgres://collab_readonly:s3cret@127.0.0.1:5432/collab_app_test';

test('draftChildDatabaseUrls: seed stays on the draft database; same and readonly use the app database', () => {
  const draftUrl = draftDatabaseUrl(PARENT, SLUG, PROJECT_ID);
  const seed = draftChildDatabaseUrls({ source: 'seed', draftUrl, parentUrl: PARENT });
  assert.equal(seed.databaseUrlTest, draftUrl);
  assert.equal(seed.mdmDatabaseUrl, undefined);
  const copy = draftChildDatabaseUrls({ source: 'copy', draftUrl, parentUrl: PARENT });
  assert.equal(copy.databaseUrlTest, draftUrl);
  const same = draftChildDatabaseUrls({ source: 'same', draftUrl, parentUrl: PARENT });
  assert.equal(same.databaseUrlTest, PARENT);
  assert.equal(same.mdmDatabaseUrl, PARENT);
  const readonly = draftChildDatabaseUrls({ source: 'readonly', draftUrl, parentUrl: PARENT, readonlyUrl: READONLY });
  assert.equal(readonly.databaseUrlTest, READONLY);
  assert.equal(readonly.mdmDatabaseUrl, READONLY);
  assert.throws(
    () => draftChildDatabaseUrls({ source: 'readonly', draftUrl, parentUrl: PARENT }),
    (err: unknown) => err instanceof DraftDatabaseError && /not configured on this server/.test((err as Error).message),
  );
});

test('shared draft drift names the module and the way out', () => {
  assert.deepEqual(sharedDraftDrift({ mode: 'none', rebuild: [], untouched: ['orders'], removed: [] }), []);
  assert.deepEqual(sharedDraftDrift({ mode: 'recordOnly', rebuild: [], untouched: [], removed: [] }), []);
  assert.deepEqual(sharedDraftDrift({ mode: 'modules', rebuild: ['orders'], untouched: [], removed: ['billing'] }), ['billing', 'orders']);
  const message = sharedDraftSchemaMessage(['orders']);
  assert.match(message, /orders/);
  assert.match(message, /sample data or a copy/);
  assert.deepEqual(sharedDraftSchemaModules(`${message} DRAFT_SCHEMA_DIFF modules=orders`), ['orders']);
  assert.match(sharedDraftSchemaMessage(['orders'], 'pt'), /dados de exemplo/);
});

test('ensure spawns same and readonly with both urls on the app database and refuses a missing readonly url', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-shared-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTest = process.env.DATABASE_URL_TEST;
  const prevReadonly = process.env.DATABASE_URL_READONLY;
  process.env.COLLAB_DEV_PORT_RANGE = '4600-4699';
  process.env.DATABASE_URL_TEST = PARENT;
  delete process.env.DATABASE_URL_READONLY;
  const dir = join(base, 'drafts', SLUG);
  mkdirSync(join(dir, 'mls-102047'), { recursive: true });
  mkdirSync(join(base, `current-${PROJECT_ID}`), { recursive: true });
  writeFileSync(join(base, `current-${PROJECT_ID}`, 'config.json'), '{"release":true}\n');
  const calls: Array<{ env: Record<string, string> }> = [];
  const spawnDev: DevSpawn = (_command, _args, options) => {
    calls.push({ env: options.env });
    return { pid: 2_147_483_646 };
  };
  const opts = { base, slug: SLUG, clientProjectId: PROJECT_ID, spawn: spawnDev, now: () => 1, writeConfig: () => {} };
  try {
    writeFileSync(join(dir, 'data.json'), `${JSON.stringify({ source: 'readonly', at: 't', by: 'ana' })}\n`);
    assert.throws(() => ensureDevProcess(opts), /not configured on this server/);
    assert.equal(calls.length, 0);
    assert.equal(readDraftData(dir).source, 'readonly');

    process.env.DATABASE_URL_READONLY = READONLY;
    calls.length = 0;
    ensureDevProcess(opts);
    assert.equal(calls[0].env.DATABASE_URL_TEST, READONLY);
    assert.equal(calls[0].env.MDM_DATABASE_URL, READONLY);
    assert.equal(calls[0].env.COLLAB_DRAFT_DATA_SOURCE, 'readonly');

    writeFileSync(join(dir, 'data.json'), `${JSON.stringify({ source: 'same', at: 't', by: 'ana' })}\n`);
    calls.length = 0;
    ensureDevProcess(opts);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].env.DATABASE_URL_TEST, PARENT);
    assert.equal(calls[0].env.MDM_DATABASE_URL, PARENT);
    assert.equal(calls[0].env.COLLAB_DRAFT_DATA_SOURCE, 'same');
  } finally {
    rmSync(base, { recursive: true, force: true });
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTest === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTest;
    if (prevReadonly === undefined) delete process.env.DATABASE_URL_READONLY;
    else process.env.DATABASE_URL_READONLY = prevReadonly;
  }
});

test('cmd on a read-only draft is refused and qry is not', async () => {
  assert.equal(refuseDraftReadonlyWrite('readonly', 'qryListItem'), '');
  assert.equal(refuseDraftReadonlyWrite('same', 'cmdSaveItem'), '');
  assert.match(refuseDraftReadonlyWrite('readonly', 'cmdSaveItem'), /read-only/);
  const prev = process.env.COLLAB_DRAFT_DATA_SOURCE;
  const prevRuntime = process.env.RUNTIME_MODE;
  process.env.COLLAB_DRAFT_DATA_SOURCE = 'readonly';
  process.env.RUNTIME_MODE = 'memory';
  process.env.APP_ENV = 'development';
  try {
    const refused = await execBff({
      routine: 'any.page.cmdSaveItem',
      params: {},
      meta: { source: 'http' },
    }, createRequestContext());
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.response.ok, false);
    assert.equal(refused.response.error?.code, 'DRAFT_READONLY');
    assert.match(refused.response.error?.message ?? '', /Nothing was saved/);
  } finally {
    if (prev === undefined) delete process.env.COLLAB_DRAFT_DATA_SOURCE;
    else process.env.COLLAB_DRAFT_DATA_SOURCE = prev;
    if (prevRuntime === undefined) delete process.env.RUNTIME_MODE;
    else process.env.RUNTIME_MODE = prevRuntime;
  }
});

test('readonly without the url changes nothing; same and readonly record; a schema diff is returned; seed recreates', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-shared-'));
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    login: process.env.CBE_REQUIRE_LOGIN,
    testDatabase: process.env.DATABASE_URL_TEST,
    database: process.env.DATABASE_URL,
    readonly: process.env.DATABASE_URL_READONLY,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REQUIRE_LOGIN = 'never';
  process.env.DATABASE_URL_TEST = PARENT;
  process.env.DATABASE_URL = PARENT;
  delete process.env.DATABASE_URL_READONLY;
  const orig = {
    alpha: draftDataHooks.alphaOn,
    authorities: draftDataHooks.authoritiesOf,
    email: sessionHooks.emailOf,
    drop: draftDbHooks.dropDatabase,
    stop: draftDevHooks.stopDevProcess,
    ensure: draftDevHooks.ensureDevProcess,
    prepare: draftPrepareHooks.awaitDraftPrepare,
    wait: draftDevHooks.waitForDevReady,
    perform: draftCopyHooks.perform,
  };
  let authorities: readonly string[] = [];
  const order: string[] = [];
  let ready = true;
  draftDataHooks.alphaOn = () => false;
  draftDataHooks.authoritiesOf = async () => authorities;
  sessionHooks.emailOf = async () => 'ana@x.com';
  draftDbHooks.dropDatabase = async () => { order.push('drop'); };
  draftPrepareHooks.awaitDraftPrepare = async () => { order.push('prepare'); };
  draftDevHooks.stopDevProcess = () => { order.push('stop'); };
  draftDevHooks.ensureDevProcess = () => {
    order.push(`start:${readDraftData(draftDirOf(base, SLUG)).source}`);
    return { port: 1, pid: 1, startedAt: 0, lastRequestAt: 0, database: 'collab_app_draft_team_102047', codeId: 'test' };
  };
  draftDevHooks.waitForDevReady = async () => ready;
  draftCopyHooks.perform = async () => {
    order.push(`copy:${readDraftData(draftDirOf(base, SLUG)).source}`);
    return { ok: true, tables: ['mls102047_orders_item'] };
  };
  const app = Fastify();
  registerCbeRoutes(app);
  const dir = draftDirOf(base, SLUG);
  mkdirSync(dir, { recursive: true });
  try {
    authorities = ['draftData.readonly'];
    const missing = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftReadonly', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(missing.statusCode, 500, missing.body);
    assert.equal(missing.json().code, 'DRAFT_DATA_UNCONFIGURED');
    assert.match(missing.json().msg, /not configured on this server/);
    assert.equal(order.length, 0);
    assert.equal(readDraftData(dir).source, 'seed');

    authorities = [];
    process.env.DATABASE_URL_READONLY = READONLY;
    const denied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftSame', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(readDraftData(dir).source, 'seed');

    authorities = ['draftData.sameDatabase'];
    ready = false;
    mkdirSync(join(base, 'logs'), { recursive: true });
    writeFileSync(join(base, 'logs', `dev-${SLUG}.log`), 'DRAFT_SCHEMA_DIFF modules=orders\n');
    const diff = await app.inject({
      method: 'POST',
      url: '/exec',
      headers: { 'accept-language': 'en' },
      payload: { action: 'draftSame', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(diff.statusCode, 500, diff.body);
    assert.equal(diff.json().code, 'DRAFT_SCHEMA_DIFF');
    assert.match(diff.json().msg, /orders/);
    assert.match(diff.json().msg, /sample data or a copy/);
    assert.equal(readDraftData(dir).source, 'same');
    const failedLog = readFileSync(join(dir, 'data.log.jsonl'), 'utf8');
    assert.match(failedLog, /"action":"sameDatabase"/);
    assert.match(failedLog, /"result":"failed"/);

    ready = true;
    order.length = 0;
    authorities = ['draftData.readonly'];
    const okReadonly = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftReadonly', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(okReadonly.statusCode, 200, okReadonly.body);
    assert.equal(okReadonly.json().source, 'readonly');
    assert.equal(readDraftData(dir).source, 'readonly');
    assert.match(readFileSync(join(dir, 'data.log.jsonl'), 'utf8'), /"action":"readonly".*"result":"ok"/);

    authorities = ['draftData.reset'];
    order.length = 0;
    const reset = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftResetDatabase', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.deepEqual(order, ['prepare', 'stop', 'drop', 'start:seed']);
    assert.equal(readDraftData(dir).source, 'seed');

    writeFileSync(join(dir, 'data.json'), `${JSON.stringify({ source: 'same', at: 't', by: 'ana' })}\n`);
    authorities = ['draftData.copy'];
    order.length = 0;
    const copied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftCopy', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(copied.statusCode, 200, copied.body);
    assert.deepEqual(order, ['prepare', 'stop', 'start:seed', 'stop', 'copy:seed']);
  } finally {
    draftDataHooks.alphaOn = orig.alpha;
    draftDataHooks.authoritiesOf = orig.authorities;
    sessionHooks.emailOf = orig.email;
    draftDbHooks.dropDatabase = orig.drop;
    draftDevHooks.stopDevProcess = orig.stop;
    draftDevHooks.ensureDevProcess = orig.ensure;
    draftPrepareHooks.awaitDraftPrepare = orig.prepare;
    draftDevHooks.waitForDevReady = orig.wait;
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
    if (prev.readonly === undefined) delete process.env.DATABASE_URL_READONLY;
    else process.env.DATABASE_URL_READONLY = prev.readonly;
    rmSync(base, { recursive: true, force: true });
  }
});
