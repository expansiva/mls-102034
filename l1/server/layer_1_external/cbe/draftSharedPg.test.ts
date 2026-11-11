/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftSharedPg.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { draftChildDatabaseUrls } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { assertSharedDraftSchema, SharedDraftSchemaError } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';

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

async function catalog(connectionString: string): Promise<string> {
  const rows = await rowsOf(
    connectionString,
    `SELECT c.relname, c.relkind::text AS kind
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
     ORDER BY 1, 2`,
  );
  return JSON.stringify(rows);
}

test('same writes through the child url land in the origin; a different hash changes no table', { skip: !optedIn, timeout: 120_000 }, async () => {
  const adminUrl = tunnelUrl();
  const hex = randomBytes(4).toString('hex');
  const name = `collab_app_draft_st70s4_${hex}`;
  const origin = withDatabase(adminUrl, name);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const pool = new Pool({ connectionString: origin });
  try {
    const who = await rowsOf(adminUrl, 'SELECT current_user AS user');
    assert.equal(who[0]?.user, 'collab');
    await admin.query(`CREATE DATABASE ${quoteDb(name)}`);
    await rowsOf(origin, 'CREATE TABLE draft_same_probe (id text PRIMARY KEY, note text NOT NULL)');
    await rowsOf(origin, 'CREATE TABLE keep_count (id integer PRIMARY KEY)');
    await rowsOf(origin, 'INSERT INTO keep_count (id) VALUES (1)');
    const urls = draftChildDatabaseUrls({
      source: 'same',
      draftUrl: withDatabase(adminUrl, `collab_app_draft_st70s4b_${hex}`),
      parentUrl: origin,
    });
    assert.equal(new URL(urls.databaseUrlTest).pathname, `/${name}`);
    assert.equal(urls.mdmDatabaseUrl && new URL(urls.mdmDatabaseUrl).pathname, `/${name}`);
    await rowsOf(urls.databaseUrlTest, `INSERT INTO draft_same_probe (id, note) VALUES ('1', 'from-draft')`);
    const written = await rowsOf(origin, `SELECT note FROM draft_same_probe WHERE id = '1'`);
    assert.equal(written[0]?.note, 'from-draft');

    const beforeCatalog = await catalog(origin);
    const beforeCount = await rowsOf(origin, 'SELECT count(*)::int AS n FROM keep_count');
    const current = new Map<string, string>([['102047:orders', 'draft-hash']]);
    await assert.rejects(
      () => assertSharedDraftSchema({
        pool,
        current,
        currentSnapshotId: 'snap-draft',
        ownProjects: ['102047'],
      }),
      (err: unknown) => {
        assert.ok(err instanceof SharedDraftSchemaError);
        assert.deepEqual(err.modules, ['orders']);
        assert.match(err.message, /orders/);
        assert.match(err.message, /sample data or a copy/);
        return true;
      },
    );
    assert.equal(await catalog(origin), beforeCatalog);
    const afterCount = await rowsOf(origin, 'SELECT count(*)::int AS n FROM keep_count');
    assert.equal(afterCount[0]?.n, beforeCount[0]?.n);
    const probe = await rowsOf(origin, 'SELECT count(*)::int AS n FROM draft_same_probe');
    assert.equal(probe[0]?.n, 1);
  } finally {
    await pool.end();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteDb(name)} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});
