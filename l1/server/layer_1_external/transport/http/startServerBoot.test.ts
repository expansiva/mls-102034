/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServerBoot.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bootSteps,
  buildBootConfig,
  buildBootConfigScript,
  failFrontendRegistryBoot,
  resolveModuleBoot,
} from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { getFrontendAppRegistrations } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';

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

test('GET /_moduleBoot JSON equals the collabBoot object injected in HTML', async () => {
  const apps = await getFrontendAppRegistrations();
  const app = apps.find((candidate) => candidate.routes.length > 0);
  assert.ok(app, 'expected a registered frontend app with routes');
  const obj = await buildBootConfig(app);
  const script = await buildBootConfigScript(app);
  const marker = 'window.collabBoot=';
  const payloadStart = script.indexOf(marker);
  assert.ok(payloadStart >= 0, 'expected collabBoot payload in boot script');
  const jsonStart = payloadStart + marker.length;
  const jsonEnd = script.indexOf(';window.', jsonStart);
  assert.ok(jsonEnd > jsonStart, 'expected collabBoot payload terminator');
  const fromHtml = JSON.parse(script.slice(jsonStart, jsonEnd).replace(/\\u003c/gu, '<'));
  assert.deepEqual(fromHtml, JSON.parse(JSON.stringify(obj)));
  const viaRoute = await resolveModuleBoot(app.basePath);
  assert.equal(viaRoute.status, 200);
  assert.deepEqual(viaRoute.body, obj);
});

test('GET /_moduleBoot unknown basePath is 404 JSON', async () => {
  const result = await resolveModuleBoot('/__no_such_module__');
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { statusCode: 404, msg: 'Not found' });
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
