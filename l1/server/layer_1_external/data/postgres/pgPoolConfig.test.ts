/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/pgPoolConfig.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { pgPoolConfigForDatabase, sharedPgDatabaseName } from '/_102034_/l1/server/layer_1_external/data/postgres/pg.js';

const SECRET = 's3cret-pool';
const DRAFT = 'collab_app_draft_102047_u48b2698f03c6';
const BASE = `postgres://collab:${SECRET}@127.0.0.1:5432/collab_app_test`;

const env = {
  appEnv: 'development',
  runtimeMode: 'postgres',
  pgHost: '127.0.0.1',
  pgPort: 5432,
  pgDatabase: 'mdm',
  pgUser: 'postgres',
  pgPassword: 'legacy-secret',
} as AppEnv;

function withDatabaseUrl(value: string | undefined, run: () => void): void {
  const previous = process.env.DATABASE_URL_TEST;
  if (value === undefined) delete process.env.DATABASE_URL_TEST;
  else process.env.DATABASE_URL_TEST = value;
  const lines: string[] = [];
  const write = (level: 'log' | 'warn' | 'error') => (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
    void level;
  };
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = write('log');
  console.warn = write('warn');
  console.error = write('error');
  try {
    run();
    const dumped = lines.join('\n');
    assert.equal(dumped.includes(SECRET), false);
    assert.equal(dumped.includes('legacy-secret'), false);
    assert.equal(dumped.includes(BASE), false);
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
    if (previous === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = previous;
  }
}

test('another database keeps the shared connection string and changes only the database name', () => {
  withDatabaseUrl(BASE, () => {
    assert.equal(sharedPgDatabaseName(env), 'collab_app_test');
    const same = pgPoolConfigForDatabase(env, 'collab_app_test');
    assert.deepEqual(same, { connectionString: BASE });
    const other = pgPoolConfigForDatabase(env, DRAFT);
    assert.deepEqual(other, {
      connectionString: `postgres://collab:${SECRET}@127.0.0.1:5432/${DRAFT}`,
    });
    const text = JSON.stringify(other);
    assert.equal(text.includes('://postgres:'), false);
    assert.equal(text.includes(env.pgPassword), false);
  });
});

function withDeclaredMode(projectId: string, appEnv: string | undefined, run: () => void): void {
  const root = mkdtempSync(join(tmpdir(), 'rt268-pg-'));
  const previous = process.cwd();
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({
    defaultProjectId: projectId,
    projects: { [projectId]: { type: 'client' } },
  })}\n`);
  const projectDir = join(root, `mls-${projectId}`, 'l5');
  mkdirSync(projectDir, { recursive: true });
  const body = appEnv === undefined ? {} : { appEnv };
  writeFileSync(join(projectDir, 'project.json'), `${JSON.stringify(body)}\n`);
  process.chdir(root);
  try {
    run();
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
}

function withoutUrls(run: () => void): void {
  const previousUrl = process.env.DATABASE_URL;
  const previousTest = process.env.DATABASE_URL_TEST;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_TEST;
  try {
    run();
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousTest === undefined) delete process.env.DATABASE_URL_TEST;
    else process.env.DATABASE_URL_TEST = previousTest;
  }
}

test('a declared test mode with no URL fails and does not use the legacy connection', () => {
  withoutUrls(() => {
    withDeclaredMode('268901', 'presentation', () => {
      const declared = { ...env, projectId: '268901' } as AppEnv;
      assert.throws(() => sharedPgDatabaseName(declared), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL_TEST is not set/u);
        assert.match(error.message, /never used as a fallback/u);
        assert.equal(error.message.includes('mdm'), false);
        assert.equal(error.message.includes(env.pgPassword), false);
        return true;
      });
    });
  });
});

test('a declared test mode connects through DATABASE_URL_TEST', () => {
  withDatabaseUrl(BASE, () => {
    withDeclaredMode('268902', 'development', () => {
      const declared = { ...env, projectId: '268902' } as AppEnv;
      assert.equal(sharedPgDatabaseName(declared), 'collab_app_test');
      assert.deepEqual(pgPoolConfigForDatabase(declared, 'collab_app_test'), { connectionString: BASE });
    });
  });
});

test('a declared production mode without a URL keeps the legacy connection', () => {
  withoutUrls(() => {
    withDeclaredMode('268903', 'production', () => {
      const declared = { ...env, projectId: '268903' } as AppEnv;
      assert.equal(sharedPgDatabaseName(declared), 'mdm');
      assert.deepEqual(pgPoolConfigForDatabase(declared, DRAFT), {
        host: '127.0.0.1',
        port: 5432,
        database: DRAFT,
        user: 'postgres',
        password: 'legacy-secret',
      });
    });
  });
});

test('a project that declares no mode keeps the legacy connection', () => {
  withoutUrls(() => {
    withDeclaredMode('268904', undefined, () => {
      const declared = { ...env, projectId: '268904' } as AppEnv;
      assert.equal(sharedPgDatabaseName(declared), 'mdm');
    });
  });
});

test('without a connection string the legacy host, user and password stay', () => {
  withDatabaseUrl(undefined, () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      assert.equal(sharedPgDatabaseName(env), 'mdm');
      assert.deepEqual(pgPoolConfigForDatabase(env, DRAFT), {
        host: '127.0.0.1',
        port: 5432,
        database: DRAFT,
        user: 'postgres',
        password: 'legacy-secret',
      });
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
