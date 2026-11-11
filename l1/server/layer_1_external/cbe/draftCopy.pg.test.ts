/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftCopy.pg.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { draftDirOf } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { readDraftData } from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import { performDraftCopy } from '/_102034_/l1/server/layer_1_external/cbe/draftCopy.js';
import { parseDatabaseUrl } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';
const PROJECT_ID = 102047;

function tunnelUrl(): string {
  const raw = process.env.DRAFT_LOGIN_COPY_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DRAFT_LOGIN_COPY_PG_URL must be a local tunnel URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  const hostOk = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (!hostOk || url.port !== '55432' || database !== 'collab_app_test') {
    throw new Error('DRAFT_LOGIN_COPY_PG_URL must be 127.0.0.1:55432/collab_app_test');
  }
  return raw;
}

function withDatabase(raw: string, name: string): string {
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteDb(name: string): string {
  if (!/^collab_app_draft_[a-z0-9_]+$/u.test(name) || name === 'collab_app_test') {
    throw new Error('refusing database name');
  }
  return `"${name}"`;
}

function scrub(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres:\/\/\S+/giu, 'postgres://***').replace(/\s+/gu, ' ').slice(0, 180);
}

async function exec(connectionString: string, text: string, params: unknown[] = []): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function rowsOf(connectionString: string, text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<Record<string, unknown>>(text, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

const SCHEMA = `
  CREATE TABLE mls102047_orders_item (
    id text PRIMARY KEY,
    details jsonb NOT NULL
  );
  CREATE TABLE mdm_documents (
    "mdmId" text PRIMARY KEY,
    details jsonb NOT NULL
  );
  CREATE TABLE mdm_outbox (
    id text PRIMARY KEY,
    payload jsonb NOT NULL
  );
  CREATE TABLE monitor_bff_execution_log (
    id text PRIMARY KEY,
    payload jsonb NOT NULL
  );
`;

test('opt-in without the lima tunnel URL fails', () => {
  if (!optedIn) return;
  tunnelUrl();
});

test('copy matches counts and jsonb md5; a different column returns the draft to seed', { skip: !optedIn, timeout: 120_000 }, async () => {
  const adminUrl = tunnelUrl();
  const hex = randomBytes(4).toString('hex');
  const sourceName = `collab_app_draft_st70s3_${hex}`;
  const targetName = `collab_app_draft_st70s3b_${hex}`;
  const brokenName = `collab_app_draft_st70s3c_${hex}`;
  const sourceUrl = withDatabase(adminUrl, sourceName);
  const targetUrl = withDatabase(adminUrl, targetName);
  const brokenSourceUrl = withDatabase(adminUrl, `${sourceName}_c`);
  const brokenUrl = withDatabase(adminUrl, brokenName);
  const parsedAdmin = parseDatabaseUrl(targetUrl);
  assert.ok(parsedAdmin);
  const base = mkdtempSync(join(tmpdir(), 'draft-copy-pg-'));
  const dir = draftDirOf(base, 'team-102047');
  const brokenDir = draftDirOf(base, 'team-102047b');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const names = [sourceName, targetName, `${sourceName}_c`, brokenName];
  let started = 0;
  try {
    const who = await rowsOf(adminUrl, 'SELECT current_user AS user');
    assert.equal(who[0]?.user, 'collab');
    for (const name of names) await admin.query(`CREATE DATABASE ${quoteDb(name)}`);
    await exec(sourceUrl, SCHEMA);
    await exec(targetUrl, SCHEMA);
    await exec(sourceUrl, `INSERT INTO mls102047_orders_item (id, details) VALUES ('a', '{"n":1}'::jsonb), ('b', '{"n":2}'::jsonb)`);
    await exec(sourceUrl, `INSERT INTO mdm_documents ("mdmId", details) VALUES ('doc-1', '{"kind":"person"}'::jsonb)`);
    await exec(sourceUrl, `INSERT INTO mdm_outbox (id, payload) VALUES ('src', '{"from":"app"}'::jsonb)`);
    await exec(sourceUrl, `INSERT INTO monitor_bff_execution_log (id, payload) VALUES ('src', '{"from":"app"}'::jsonb)`);
    await exec(targetUrl, `INSERT INTO mls102047_orders_item (id, details) VALUES ('old', '{"n":0}'::jsonb)`);
    await exec(targetUrl, `INSERT INTO mdm_documents ("mdmId", details) VALUES ('old', '{"kind":"old"}'::jsonb)`);
    await exec(targetUrl, `INSERT INTO mdm_outbox (id, payload) VALUES ('keep', '{"from":"draft"}'::jsonb)`);
    await exec(targetUrl, `INSERT INTO monitor_bff_execution_log (id, payload) VALUES ('keep', '{"from":"draft"}'::jsonb)`);

    const copied = await performDraftCopy({
      sourceUrl,
      targetUrl,
      projectId: PROJECT_ID,
      draftDir: dir,
      by: 'ana@x.com',
      lang: 'en',
      adminUrl: parsedAdmin.adminUrl,
      database: targetName,
      dropDatabase: async () => {
        throw new Error('success path must not drop');
      },
      start: () => {
        started += 1;
      },
    });
    assert.equal(copied.ok, true);
    if (!copied.ok) return;
    assert.deepEqual(copied.tables, ['mdm_documents', 'mls102047_orders_item']);
    assert.equal(started, 1);
    assert.equal(readDraftData(dir).source, 'copy');
    const orderMd5 = async (url: string) => rowsOf(url, `SELECT md5(details::text) AS hash FROM mls102047_orders_item ORDER BY id`);
    const docMd5 = async (url: string) => rowsOf(url, `SELECT md5(details::text) AS hash FROM mdm_documents ORDER BY "mdmId"`);
    assert.deepEqual(await orderMd5(targetUrl), await orderMd5(sourceUrl));
    assert.deepEqual(await docMd5(targetUrl), await docMd5(sourceUrl));
    assert.equal((await rowsOf(targetUrl, 'SELECT count(*)::int AS n FROM mls102047_orders_item'))[0]?.n, 2);
    assert.deepEqual(await rowsOf(targetUrl, 'SELECT id FROM mdm_outbox ORDER BY id'), [{ id: 'keep' }]);
    assert.deepEqual(await rowsOf(targetUrl, 'SELECT id FROM monitor_bff_execution_log ORDER BY id'), [{ id: 'keep' }]);

    await exec(brokenSourceUrl, SCHEMA);
    await exec(brokenUrl, SCHEMA);
    await exec(brokenSourceUrl, `ALTER TABLE mls102047_orders_item ADD COLUMN note text`);
    await exec(brokenSourceUrl, `INSERT INTO mls102047_orders_item (id, details, note) VALUES ('a', '{"n":1}'::jsonb, 'x')`);
    await exec(brokenUrl, `INSERT INTO mls102047_orders_item (id, details) VALUES ('old', '{"n":9}'::jsonb)`);
    let seedStarted = 0;
    const broken = await performDraftCopy({
      sourceUrl: brokenSourceUrl,
      targetUrl: brokenUrl,
      projectId: PROJECT_ID,
      draftDir: brokenDir,
      by: 'ana@x.com',
      lang: 'en',
      adminUrl: parsedAdmin.adminUrl,
      database: brokenName,
      dropDatabase: async (adminConnection, database) => {
        const drop = new Client({ connectionString: adminConnection });
        await drop.connect();
        try {
          await drop.query(`DROP DATABASE IF EXISTS ${quoteDb(database)} WITH (FORCE)`);
        } finally {
          await drop.end();
        }
      },
      start: () => {
        seedStarted += 1;
      },
    });
    assert.equal(broken.ok, false);
    if (broken.ok) return;
    assert.equal(broken.table, 'mls102047_orders_item');
    assert.match(broken.msg, /columns do not match/);
    assert.match(broken.msg, /mls102047_orders_item/);
    assert.equal(broken.seeded, true);
    assert.equal(seedStarted, 1);
    assert.equal(readDraftData(brokenDir).source, 'seed');
    const left = await rowsOf(adminUrl, 'SELECT datname FROM pg_database WHERE datname = $1', [brokenName]);
    assert.equal(left.length, 0);
    const sourceLeft = await rowsOf(adminUrl, 'SELECT datname FROM pg_database WHERE datname = $1', [`${sourceName}_c`]);
    assert.equal(sourceLeft.length, 1);
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    throw new Error(scrub(err));
  } finally {
    rmSync(base, { recursive: true, force: true });
    for (const name of names) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteDb(name)} WITH (FORCE)`);
      } catch (err) {
        console.error(`[cbe] draft copy drop failed: ${scrub(err)}`);
      }
    }
    await admin.end();
  }
});
