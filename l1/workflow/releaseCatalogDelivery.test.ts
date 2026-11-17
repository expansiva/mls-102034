/// <mls fileReference="_102034_/l1/workflow/releaseCatalogDelivery.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AssistantCatalog, AssistantCatalogSource, CatalogLoad } from '/_102034_/l1/workflow/assistantCatalog.js';
import type { ConnectionServeInput } from '/_102034_/l1/workflow/connectionServe.js';
import { deliverReleaseCatalog, hashCatalogs, type ReleaseCatalogDeliveryDeps } from '/_102034_/l1/workflow/releaseCatalogDelivery.js';
import type { ConnectionResult } from '/_102034_/l4/ontology/connections/types.defs.js';

const CTX = {} as RequestContext;

function catalogOf(module: string, extra: Record<string, unknown> = {}): AssistantCatalog {
  return { schemaVersion: 'assistant-catalog-v1', module, commands: [], queries: [], ...extra } as AssistantCatalog;
}

function harness(over: { releaseId?: string | null; catalogs?: Record<string, CatalogLoad>; answer?: ConnectionResult | Error; stored?: Record<string, unknown> | null; organizationId?: string | undefined; kvPutFails?: boolean } = {}) {
  const served: ConnectionServeInput[] = [];
  const puts: Array<{ key: string; value: Record<string, unknown> }> = [];
  const logs: string[] = [];
  let stored = over.stored ?? null;
  const catalogs: Record<string, CatalogLoad> = over.catalogs ?? { modA: { ok: true, catalog: catalogOf('modA') }, modB: { ok: true, catalog: catalogOf('modB', { title: 'B' }) } };
  const source: AssistantCatalogSource = { get: async (moduleId) => catalogs[moduleId] ?? { ok: false, code: 'ASSISTANT_CATALOG_INVALID' } };
  const deps: ReleaseCatalogDeliveryDeps = {
    projectId: '999001',
    releaseId: () => (over.releaseId === undefined ? 'rel-1' : over.releaseId),
    moduleIds: () => Object.keys(catalogs),
    catalogs: source,
    serve: async (input) => {
      served.push(input);
      const answer = over.answer ?? { ok: true, output: {} };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    organizationId: () => ('organizationId' in over ? over.organizationId : 'org-1'),
    kv: {
      get: async () => (stored === null ? null : { value: stored }),
      put: async (_ctx, params) => {
        if (over.kvPutFails) throw new Error('db down');
        puts.push(params);
        stored = params.value;
        return params;
      },
    },
    newContext: () => CTX,
    log: { info: (line) => logs.push(`info ${line}`), error: (line) => logs.push(`error ${line}`) },
  };
  return { deps, served, puts, logs };
}

test('a new hash is delivered to platform.releaseCatalogChanged with the key <releaseId>:<hash>, and only then it is kept', async () => {
  const h = harness();
  assert.equal(await deliverReleaseCatalog(h.deps), 'delivered');
  assert.equal(h.served.length, 1);
  const call = h.served[0];
  assert.equal(call.connectionId, 'platform');
  assert.equal(call.operationId, 'releaseCatalogChanged');
  assert.deepEqual(call.context, { organizationId: 'org-1' });
  const input = call.input as { releaseId: string; hash: string; catalogs: AssistantCatalog[] };
  assert.equal(input.releaseId, 'rel-1');
  assert.deepEqual(input.catalogs.map((catalog) => catalog.module), ['modA', 'modB']);
  assert.equal(input.hash, hashCatalogs(input.catalogs));
  assert.equal(call.idempotencyKey, `rel-1:${input.hash}`);
  assert.equal(h.puts.length, 1);
  assert.equal(h.puts[0].key, 'release-catalog:999001');
  assert.equal(h.puts[0].value.hash, input.hash);
});

test('the same hash is not delivered again, even on another release; a change is', async () => {
  const first = harness();
  await deliverReleaseCatalog(first.deps);
  const kept = first.puts[0].value;
  const again = harness({ stored: kept, releaseId: 'rel-2' });
  assert.equal(await deliverReleaseCatalog(again.deps), 'unchanged');
  assert.equal(again.served.length, 0);
  const changed = harness({ stored: kept, catalogs: { modA: { ok: true, catalog: catalogOf('modA', { issues: ['NEW'] }) } } });
  assert.equal(await deliverReleaseCatalog(changed.deps), 'delivered');
});

test('the hash does not depend on the order of the modules or of the keys', () => {
  const a = catalogOf('a', { x: 1, y: 2 });
  const b = catalogOf('b');
  assert.equal(hashCatalogs([a, b]), hashCatalogs([b, { y: 2, x: 1, ...catalogOf('a') } as AssistantCatalog]));
  assert.notEqual(hashCatalogs([a, b]), hashCatalogs([a]));
});

test('with no module that serves it nothing is delivered, the hash is not kept and one line says so', async () => {
  const h = harness({ answer: { ok: false, code: 'not_found', message: 'no route' } });
  assert.equal(await deliverReleaseCatalog(h.deps), 'no_module');
  assert.equal(h.puts.length, 0);
  assert.ok(h.logs.some((line) => line.includes('no module serves platform.releaseCatalogChanged')));
});

test('a failure keeps no hash and says the code in one line, so the next boot tries again; nothing throws', async () => {
  for (const answer of [{ ok: false, code: 'unavailable', message: 'x' } as ConnectionResult, { ok: false, code: 'forbidden', message: 'x' } as ConnectionResult, new Error('boom')]) {
    const h = harness({ answer });
    assert.equal(await deliverReleaseCatalog(h.deps), 'failed');
    assert.equal(h.puts.length, 0);
    assert.ok(h.logs.some((line) => line.startsWith('error [release-catalog] not delivered')));
  }
  const putFails = harness({ kvPutFails: true });
  assert.equal(await deliverReleaseCatalog(putFails.deps), 'failed');
});

test('outside a release, with no organization or with no catalog nothing is delivered', async () => {
  assert.equal(await deliverReleaseCatalog(harness({ releaseId: null }).deps), 'skipped');
  const noOrg = harness({ organizationId: undefined });
  assert.equal(await deliverReleaseCatalog(noOrg.deps), 'skipped');
  assert.equal(noOrg.served.length, 0);
  const none = harness({ catalogs: { modA: { ok: false, code: 'ASSISTANT_CATALOG_INVALID' } } });
  assert.equal(await deliverReleaseCatalog(none.deps), 'skipped');
  assert.equal(none.served.length, 0);
});

test('a module whose catalog is not ready does not stop the others: the rest is delivered', async () => {
  const h = harness({ catalogs: { modA: { ok: true, catalog: catalogOf('modA') }, modB: { ok: false, code: 'ASSISTANT_CATALOG_INVALID' } } });
  assert.equal(await deliverReleaseCatalog(h.deps), 'delivered');
  assert.deepEqual((h.served[0].input as { catalogs: AssistantCatalog[] }).catalogs.map((catalog) => catalog.module), ['modA']);
});

test('the boot does not wait for the delivery and a failure of it never reaches the boot', () => {
  const source = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/layer_1_external/transport/http/startServer.ts'), 'utf8');
  assert.match(source, /void runners\.warmCatalogs\(\)\.then\(\(\) => runners\.deliverReleaseCatalog\(\)\)\.catch\(/);
  assert.doesNotMatch(source, /await runners\.deliverReleaseCatalog/);
});
