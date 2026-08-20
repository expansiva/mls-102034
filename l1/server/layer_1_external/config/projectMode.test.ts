/// <mls fileReference="_102034_/l1/server/layer_1_external/config/projectMode.test.ts" enhancement="_blank" />
// The mode decides which DATABASE a published module talks to, so the two things worth pinning are the
// default (a module with nothing declared must never point at production) and the refusal (a test mode
// with no test connection string must fail loudly instead of falling back).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECT_MODE, databaseUrlEnvFor, ensureTestDatabase, isProjectMode, isTestMode, parseDatabaseUrl,
  refuseTestWrite, resolveDatabaseUrl,
} from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

test('the default is presentation — never production', () => {
  assert.equal(DEFAULT_PROJECT_MODE, 'presentation');
  assert.ok(isTestMode(DEFAULT_PROJECT_MODE));
  assert.equal(isProjectMode('presentation'), true);
  assert.equal(isProjectMode('staging'), false, 'the server APP_ENV vocabulary is a different concept');
  assert.equal(isProjectMode(undefined), false);
});

test('test modes read the TEST connection string, and its absence is an error, never a fallback', () => {
  assert.equal(databaseUrlEnvFor('presentation'), 'DATABASE_URL_TEST');
  assert.equal(databaseUrlEnvFor('development'), 'DATABASE_URL_TEST');
  assert.equal(databaseUrlEnvFor('homologation'), 'DATABASE_URL');
  assert.equal(databaseUrlEnvFor('production'), 'DATABASE_URL');

  const priorTest = process.env.DATABASE_URL_TEST;
  const prior = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL = 'postgres://production/db';
    // The bug this prevents: a presentation module writing curated seeds over real data.
    assert.throws(() => resolveDatabaseUrl('presentation'), /DATABASE_URL_TEST is not set/u);
    assert.throws(() => resolveDatabaseUrl('presentation'), /never used as a fallback/u);
    process.env.DATABASE_URL_TEST = 'postgres://test/db';
    assert.equal(resolveDatabaseUrl('presentation'), 'postgres://test/db');
    assert.equal(resolveDatabaseUrl('production'), 'postgres://production/db');
  } finally {
    if (priorTest === undefined) delete process.env.DATABASE_URL_TEST; else process.env.DATABASE_URL_TEST = priorTest;
    if (prior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prior;
  }
});

test('the server refuses a destructive test run against a non-test mode, and only that', () => {
  // The case that wrote junk into production once.
  assert.match(refuseTestWrite('production', { source: 'test', command: 'cmdDeleteClient' }), /refuses a write from the test runner/u);
  assert.match(refuseTestWrite('homologation', { source: 'test', command: 'cmdCreateClient' }), /read-only smoke/u);
  // Read-only smoke stays allowed everywhere — that is what keeps production observable.
  assert.equal(refuseTestWrite('production', { source: 'test', command: 'qryListClient' }), '');
  // Real traffic is never the runner.
  assert.equal(refuseTestWrite('production', { source: 'http', command: 'cmdDeleteClient' }), '');
  // And in a test mode the whole suite runs.
  assert.equal(refuseTestWrite('presentation', { source: 'test', command: 'cmdDeleteClient' }), '');
  assert.equal(refuseTestWrite('development', { source: 'test', command: 'cmdDeleteClient' }), '');
});

test('the test database is provisioned when missing — only the database, only in a test mode', async () => {
  const prior = process.env.DATABASE_URL_TEST;
  try {
    process.env.DATABASE_URL_TEST = 'postgres://user:pw@localhost:5432/mdm_test';
    assert.deepEqual(parseDatabaseUrl(process.env.DATABASE_URL_TEST), {
      database: 'mdm_test',
      adminUrl: 'postgres://user:pw@localhost:5432/postgres',
    });

    const created: string[] = [];
    const connect = (existing: boolean) => async (adminUrl: string) => {
      // The admin connection points at `postgres`, never at the database being created.
      assert.match(adminUrl, /\/postgres$/u);
      return {
        exists: async () => existing,
        create: async (database: string) => { created.push(database); },
        end: async () => undefined,
      };
    };

    assert.deepEqual(await ensureTestDatabase('presentation', connect(false)), { created: true, database: 'mdm_test', reason: 'created' });
    assert.deepEqual(created, ['mdm_test']);
    assert.deepEqual(await ensureTestDatabase('presentation', connect(true)), { created: false, database: 'mdm_test', reason: 'already-exists' });
    // Nobody auto-provisions production.
    assert.deepEqual(await ensureTestDatabase('production', connect(false)), { created: false, database: '', reason: 'not-a-test-mode' });
    assert.deepEqual(created, ['mdm_test'], 'no second CREATE DATABASE');

    delete process.env.DATABASE_URL_TEST;
    assert.deepEqual(await ensureTestDatabase('presentation', connect(false)), { created: false, database: '', reason: 'no-connection-string' });
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL_TEST; else process.env.DATABASE_URL_TEST = prior;
  }
});
