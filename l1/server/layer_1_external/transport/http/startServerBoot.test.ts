/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServerBoot.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootSteps, failFrontendRegistryBoot } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';

test('boot catch wires failFrontendRegistryBoot so a registry throw never becomes a zombie', () => {
  const source = readFileSync(new URL('./startServer.ts', import.meta.url), 'utf8');
  assert.match(source, /getFrontendAppRegistrations\(\)\.then/);
  assert.match(source, /\.catch\(\(error\) => \{\s*failFrontendRegistryBoot\(error\);/u);
});


test('failFrontendRegistryBoot logs the missing key and exits nonzero', () => {
  const exits: Array<number | undefined> = [];
  const logs: string[] = [];
  const origExit = process.exit;
  const origError = console.error;
  process.exit = ((code?: number) => {
    exits.push(code);
    throw new Error(`exit:${code}`);
  }) as typeof process.exit;
  console.error = ((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  }) as typeof console.error;
  try {
    assert.throws(
      () => failFrontendRegistryBoot(new Error('config.shellTemplates.spa is required (missing from client config.json)')),
      /exit:1/,
    );
    assert.equal(exits[0], 1);
    assert.match(logs.join('\n'), /frontend registry failed/);
    assert.match(logs.join('\n'), /shellTemplates\.spa is required/);
    assert.match(logs.join('\n'), /refusing to listen so pm2 marks error/);
  } finally {
    process.exit = origExit;
    console.error = origError;
  }
});

test('bootSteps runs migrations before listen when COLLAB_DRAFT is set', async () => {
  const order: string[] = [];
  await bootSteps({
    draft: true,
    runMigrations: async () => { order.push('migrate'); },
    listen: async () => { order.push('listen'); },
  });
  assert.deepEqual(order, ['migrate', 'listen']);
});

test('bootSteps does not run migrations without COLLAB_DRAFT', async () => {
  let migrated = false;
  let listened = false;
  await bootSteps({
    draft: false,
    runMigrations: async () => { migrated = true; },
    listen: async () => { listened = true; },
  });
  assert.equal(migrated, false);
  assert.equal(listened, true);
});

test('bootSteps does not listen when draft migrations fail', async () => {
  const exits: Array<number | undefined> = [];
  const logs: string[] = [];
  let listened = false;
  const origExit = process.exit;
  const origError = console.error;
  process.exit = ((code?: number) => {
    exits.push(code);
    throw new Error(`exit:${code}`);
  }) as typeof process.exit;
  console.error = ((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  }) as typeof console.error;
  try {
    await assert.rejects(
      () => bootSteps({
        draft: true,
        runMigrations: async () => { throw new Error('schema refused'); },
        listen: async () => { listened = true; },
      }),
      /exit:1/,
    );
    assert.equal(listened, false);
    assert.equal(exits[0], 1);
    assert.match(logs.join('\n'), /draft migrations failed/);
    assert.match(logs.join('\n'), /schema refused/);
    assert.match(logs.join('\n'), /\n\s+at /);
  } finally {
    process.exit = origExit;
    console.error = origError;
  }
});
