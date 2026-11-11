/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftDataSource.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { draftDirOf, draftSharedText, ensureDevProcess, type DevSpawn } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { draftDataHooks, draftDbHooks, draftDevHooks, registerCbeRoutes, sessionHooks } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import {
  DraftDataFileError,
  appendDraftDataLog,
  canDraftData,
  draftDataText,
  readDraftData,
  writeDraftData,
  DRAFT_DATA_ACTIONS,
} from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';

const PROJECT_ID = 102047;
const SLUG = 'team-102047';
const PARENT_TEST_URL = 'postgres://collab:secret@127.0.0.1:5432/collab_app_test';

test('readDraftData: missing file is seed; unreadable or invalid is an error', () => {
  const base = mkdtempSync(join(tmpdir(), 'draft-data-'));
  const dir = draftDirOf(base, SLUG);
  try {
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(readDraftData(dir), { source: 'seed', at: null, by: null });

    writeFileSync(join(dir, 'data.json'), '{');
    assert.throws(() => readDraftData(dir), (err: unknown) => {
      assert.ok(err instanceof DraftDataFileError);
      assert.match(err.message, /Draft data file is unreadable/);
      return true;
    });

    writeFileSync(join(dir, 'data.json'), '{"source":"nope"}\n');
    assert.throws(() => readDraftData(dir), /Draft data file is invalid/);

    writeDraftData(dir, { source: 'copy', at: '2026-11-11T00:00:00.000Z', by: 'ana@x.com', modules: ['inicio'], withRegistry: true });
    assert.deepEqual(readDraftData(dir), {
      source: 'copy',
      at: '2026-11-11T00:00:00.000Z',
      by: 'ana@x.com',
      modules: ['inicio'],
      withRegistry: true,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('canDraftData: alpha allows the five actions; without it the authority decides', () => {
  for (const action of DRAFT_DATA_ACTIONS) {
    assert.deepEqual(canDraftData(action, [], { alphaAllAuthorities: true }), { allowed: true });
    const refused = canDraftData(action, [], { alphaAllAuthorities: false });
    assert.equal(refused.allowed, false);
    if (!refused.allowed) {
      assert.equal(refused.statusCode, 403);
      assert.equal(refused.code, 'DRAFT_DATA_FORBIDDEN');
      assert.match(refused.msg, /permission/);
    }
    assert.deepEqual(canDraftData(action, [`draftData.${action}`], {}), { allowed: true });
    const other = canDraftData(action, ['draftData.view'], { alphaAllAuthorities: false });
    if (action === 'view') assert.equal(other.allowed, true);
    else assert.equal(other.allowed, false);
  }
  const pt = canDraftData('reset', [], { alphaAllAuthorities: false }, 'pt');
  if (!pt.allowed) assert.match(pt.msg, /permissão/);
});

test('seed and copy omit MDM_DATABASE_URL; an unreadable data.json does not spawn', () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-dev-source-'));
  const prevRange = process.env.COLLAB_DEV_PORT_RANGE;
  const prevTestDatabase = process.env.DATABASE_URL_TEST;
  process.env.COLLAB_DEV_PORT_RANGE = '4200-4299';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const dir = draftDirOf(base, SLUG);
  try {
    mkdirSync(join(base, 'current-102047'), { recursive: true });
    writeFileSync(join(base, 'current-102047', 'config.json'), '{"release":true}\n');
    mkdirSync(join(dir, 'mls-102047'), { recursive: true });
    const calls: Array<{ env: Record<string, string> }> = [];
    const spawnDev: DevSpawn = (_command, _args, options) => {
      calls.push({ env: options.env });
      return { pid: 2_147_000_001 };
    };
    const opts = {
      base,
      slug: SLUG,
      clientProjectId: PROJECT_ID,
      spawn: spawnDev,
      now: () => 1_700_000_000_000,
      writeConfig: () => {},
      portFree: () => true,
    };
    writeDraftData(dir, { source: 'copy', at: '2026-11-11T00:00:00.000Z', by: 'ana@x.com' });
    ensureDevProcess(opts);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].env.MDM_DATABASE_URL, undefined);
    assert.equal(calls[0].env.DATABASE_URL_TEST.includes('collab_app_draft_team_102047'), true);

    writeFileSync(join(dir, 'data.json'), '{');
    calls.length = 0;
    assert.throws(() => ensureDevProcess({ ...opts, slug: SLUG }), (err: unknown) => {
      assert.match((err as Error).message, /unreadable/);
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    if (prevRange === undefined) delete process.env.COLLAB_DEV_PORT_RANGE;
    else process.env.COLLAB_DEV_PORT_RANGE = prevRange;
    if (prevTestDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prevTestDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

test('draftDataSource returns source, when and who; reset records seed; authority is 403', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-data-route-'));
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    login: process.env.CBE_REQUIRE_LOGIN,
    testDatabase: process.env.DATABASE_URL_TEST,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REQUIRE_LOGIN = 'never';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  const origAlpha = draftDataHooks.alphaOn;
  const origAuthorities = draftDataHooks.authoritiesOf;
  const origEmail = sessionHooks.emailOf;
  const origDrop = draftDbHooks.dropDatabase;
  const origStop = draftDevHooks.stopDevProcess;
  const origEnsure = draftDevHooks.ensureDevProcess;
  let authorities: readonly string[] = [];
  let alpha = false;
  draftDataHooks.alphaOn = () => alpha;
  draftDataHooks.authoritiesOf = async () => authorities;
  sessionHooks.emailOf = async () => 'ana@x.com';
  draftDbHooks.dropDatabase = async () => {};
  draftDevHooks.stopDevProcess = () => {};
  draftDevHooks.ensureDevProcess = () => ({ port: 1, pid: 1, startedAt: 0, lastRequestAt: 0, database: 'collab_app_draft_team_102047', codeId: 'test' });
  const app = Fastify();
  registerCbeRoutes(app);
  const dir = draftDirOf(base, SLUG);
  try {
    const denied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftDataSource', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.match(denied.json().msg, /permission/);
    assert.equal(denied.json().code, 'DRAFT_DATA_FORBIDDEN');

    authorities = ['draftData.view'];
    const viewed = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftDataSource', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(viewed.statusCode, 200, viewed.body);
    const deniedOption = { ok: false, reason: draftDataText('forbidden', 'en') };
    assert.deepEqual(viewed.json(), {
      statusCode: 200,
      source: 'seed',
      at: null,
      by: null,
      options: { seed: deniedOption, copy: deniedOption, readonly: deniedOption, same: deniedOption },
    });

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'data.json'), '{');
    const broken = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftDataSource', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(broken.statusCode, 500, broken.body);
    assert.match(broken.json().msg, /unreadable/);
    assert.equal(broken.json().source, undefined);

    const resetDenied = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftResetDatabase', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(resetDenied.statusCode, 403, resetDenied.body);

    authorities = ['draftData.reset'];
    const reset = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftResetDatabase', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(reset.json().status, 'reset');
    const stored = readDraftData(dir);
    assert.equal(stored.source, 'seed');
    assert.equal(stored.by, 'ana@x.com');
    assert.ok(stored.at);
    const log = readFileSync(join(dir, 'data.log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { action: string; result: string; source: string; by: string });
    assert.equal(log.at(-1)?.action, 'reset');
    assert.equal(log.at(-1)?.result, 'ok');
    assert.equal(log.at(-1)?.source, 'seed');
    assert.equal(log.at(-1)?.by, 'ana@x.com');

    alpha = true;
    authorities = [];
    const alphaView = await app.inject({
      method: 'POST',
      url: '/exec',
      payload: { action: 'draftDataSource', project: PROJECT_ID, draft: SLUG },
    });
    assert.equal(alphaView.statusCode, 200, alphaView.body);
    assert.equal(alphaView.json().source, 'seed');
    assert.equal(alphaView.json().by, 'ana@x.com');
  } finally {
    draftDataHooks.alphaOn = origAlpha;
    draftDataHooks.authoritiesOf = origAuthorities;
    sessionHooks.emailOf = origEmail;
    draftDbHooks.dropDatabase = origDrop;
    draftDevHooks.stopDevProcess = origStop;
    draftDevHooks.ensureDevProcess = origEnsure;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    if (prev.testDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prev.testDatabase;
    rmSync(base, { recursive: true, force: true });
  }
});

test('draftDataSource options follow authority and whether readonly is configured', async () => {
  const base = mkdtempSync(join(tmpdir(), 'cbe-draft-data-options-'));
  const prev = {
    dir: process.env.CBE_PROJECTS_DIR,
    login: process.env.CBE_REQUIRE_LOGIN,
    testDatabase: process.env.DATABASE_URL_TEST,
    readonly: process.env.DATABASE_URL_READONLY,
  };
  process.env.CBE_PROJECTS_DIR = base;
  process.env.CBE_REQUIRE_LOGIN = 'never';
  process.env.DATABASE_URL_TEST = PARENT_TEST_URL;
  delete process.env.DATABASE_URL_READONLY;
  const origAlpha = draftDataHooks.alphaOn;
  const origAuthorities = draftDataHooks.authoritiesOf;
  let authorities: readonly string[] = [];
  let alpha = true;
  draftDataHooks.alphaOn = () => alpha;
  draftDataHooks.authoritiesOf = async () => authorities;
  const app = Fastify();
  registerCbeRoutes(app);
  const ask = (acceptLanguage?: string) => app.inject({
    method: 'POST',
    url: '/exec',
    headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
    payload: { action: 'draftDataSource', project: PROJECT_ID, draft: SLUG },
  });
  try {
    const open = await ask();
    assert.equal(open.statusCode, 200, open.body);
    const openOptions = open.json().options;
    assert.deepEqual(openOptions.readonly, { ok: false, reason: draftSharedText('notConfigured', 'en') });
    assert.deepEqual(openOptions.seed, { ok: true });
    assert.deepEqual(openOptions.copy, { ok: true });
    assert.deepEqual(openOptions.same, { ok: true });
    assert.equal(open.json().source, 'seed');
    assert.equal(open.json().at, null);
    assert.equal(open.json().by, null);

    const openPt = await ask('pt-BR,pt;q=0.9');
    assert.equal(openPt.json().options.readonly.reason, draftSharedText('notConfigured', 'pt'));

    alpha = false;
    authorities = ['draftData.view'];
    const closed = await ask();
    assert.equal(closed.statusCode, 200, closed.body);
    const forbidden = { ok: false, reason: draftDataText('forbidden', 'en') };
    assert.deepEqual(closed.json().options, { seed: forbidden, copy: forbidden, readonly: forbidden, same: forbidden });

    const closedPt = await ask('es');
    const forbiddenEs = { ok: false, reason: draftDataText('forbidden', 'es') };
    assert.deepEqual(closedPt.json().options.seed, forbiddenEs);
    assert.deepEqual(closedPt.json().options.same, forbiddenEs);

    authorities = ['draftData.view', 'draftData.copy'];
    const granted = await ask();
    assert.equal(granted.statusCode, 200, granted.body);
    assert.deepEqual(granted.json().options.copy, { ok: true });
    assert.deepEqual(granted.json().options.seed, forbidden);
    assert.deepEqual(granted.json().options.readonly, forbidden);
    assert.deepEqual(granted.json().options.same, forbidden);
  } finally {
    draftDataHooks.alphaOn = origAlpha;
    draftDataHooks.authoritiesOf = origAuthorities;
    await app.close();
    if (prev.dir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev.dir;
    if (prev.login === undefined) delete process.env.CBE_REQUIRE_LOGIN;
    else process.env.CBE_REQUIRE_LOGIN = prev.login;
    if (prev.testDatabase === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = prev.testDatabase;
    if (prev.readonly === undefined) delete process.env.DATABASE_URL_READONLY;
    else process.env.DATABASE_URL_READONLY = prev.readonly;
    rmSync(base, { recursive: true, force: true });
  }
});

test('appendDraftDataLog writes one json line', () => {
  const base = mkdtempSync(join(tmpdir(), 'draft-data-log-'));
  const dir = draftDirOf(base, SLUG);
  try {
    appendDraftDataLog(dir, { at: '2026-11-11T00:00:00.000Z', by: 'ana@x.com', action: 'reset', result: 'ok', source: 'seed' });
    const line = JSON.parse(readFileSync(join(dir, 'data.log.jsonl'), 'utf8'));
    assert.equal(line.action, 'reset');
    assert.equal(line.by, 'ana@x.com');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
