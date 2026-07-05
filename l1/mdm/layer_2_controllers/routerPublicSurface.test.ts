/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/routerPublicSurface.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { createMdmRouter } from '/_102034_/l1/mdm/layer_2_controllers/router.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';

function requireHandler(router: Map<string, BffHandler>, routine: string): BffHandler {
  const handler = router.get(routine);
  assert.ok(handler, routine);
  return handler;
}

test('public MDM router only exposes facade-backed entity and relationship routines', () => {
  const router = createMdmRouter();

  for (const routine of [
    'mdm.entity.create',
    'mdm.entity.get',
    'mdm.entity.list',
    'mdm.entity.update',
    'mdm.relationship.create',
    'mdm.relationship.list',
    'mdm.relationship.update',
    'mdm.prospect.create',
    'mdm.prospect.get',
    'mdm.prospect.list',
    'mdm.prospect.update',
    'mdm.prospect.promoteToEntity',
  ]) {
    assert.equal(router.has(routine), true, routine);
  }

  for (const routine of [
    'mdm.entity.merge',
    'mdm.prospect.promote',
    'mdm.search.run',
  ]) {
    assert.equal(router.has(routine), false, routine);
  }
});

test('legacy public MDM source files are removed', () => {
  for (const filePath of [
    'mdm/layer_3_usecases/recordUsecases.ts',
    'mdm/layer_3_usecases/relationshipUsecases.ts',
    'mdm/layer_3_usecases/recordUsecases.test.ts',
    'mdm/layer_3_usecases/relationshipUsecases.test.ts',
    'mdm/layer_4_entities/MdmDocumentEntity.ts',
    'mdm/layer_4_entities/MdmRecordEntity.ts',
    'mdm/layer_4_entities/MdmRelationshipEntity.ts',
    'mdm/layer_2_controllers/prospectHandlers.ts',
    'mdm/layer_2_controllers/searchHandler.ts',
  ]) {
    assert.equal(existsSync(filePath), false, filePath);
  }
});

test('public entity handlers delegate to the canonical MDM facade', async () => {
  const ctx = createRequestContext();
  const router = createMdmRouter();
  const create = requireHandler(router, 'mdm.entity.create');
  const get = requireHandler(router, 'mdm.entity.get');
  const list = requireHandler(router, 'mdm.entity.list');

  const created = await create({
    ctx,
    request: {
      routine: 'mdm.entity.create',
      params: {
        detail: {
          subtype: 'Location',
          name: 'Public Surface Table',
          status: 'Active',
          moduleTypes: ['cafeFlow.Table'],
        },
      },
      meta: { source: 'test' },
    },
  });
  assert.equal(created.ok, true);
  const mdmId = (created.data as { mdmId: string }).mdmId;

  const loaded = await get({
    ctx,
    request: {
      routine: 'mdm.entity.get',
      params: { mdmId },
      meta: { source: 'test' },
    },
  });
  const listed = await list({
    ctx,
    request: {
      routine: 'mdm.entity.list',
      params: { type: 'cafeFlow.Table' },
      meta: { source: 'test' },
    },
  });

  assert.equal(loaded.ok, true);
  assert.equal((loaded.data as { details: { name: string } }).details.name, 'Public Surface Table');
  assert.equal(listed.ok, true);
  assert.deepEqual((listed.data as { items: Array<{ mdmId: string }> }).items.map((item) => item.mdmId), [mdmId]);
});

test('public prospect handlers delegate to the explicit prospect facade', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const router = createMdmRouter();
  const create = requireHandler(router, 'mdm.prospect.create');
  const get = requireHandler(router, 'mdm.prospect.get');
  const list = requireHandler(router, 'mdm.prospect.list');
  const update = requireHandler(router, 'mdm.prospect.update');
  const promoteToEntity = requireHandler(router, 'mdm.prospect.promoteToEntity');

  const created = await create({
    ctx,
    request: {
      routine: 'mdm.prospect.create',
      params: {
        detail: {
          subtype: 'Company',
          name: 'Public Lead',
          legalName: 'Public Lead LLC',
          moduleTypes: ['crm.Lead'],
          promotionSource: 'web',
        },
      },
      meta: { source: 'test' },
    },
  });
  assert.equal(created.ok, true);
  const mdmId = (created.data as { mdmId: string; version: number }).mdmId;
  const version = (created.data as { version: number }).version;

  const loaded = await get({
    ctx,
    request: {
      routine: 'mdm.prospect.get',
      params: { mdmId },
      meta: { source: 'test' },
    },
  });
  const listed = await list({
    ctx,
    request: {
      routine: 'mdm.prospect.list',
      params: { type: 'crm.Lead' },
      meta: { source: 'test' },
    },
  });
  const updated = await update({
    ctx,
    request: {
      routine: 'mdm.prospect.update',
      params: {
        mdmId,
        expectedVersion: version,
        patch: { status: 'InProgress' },
      },
      meta: { source: 'test' },
    },
  });
  const promoted = await promoteToEntity({
    ctx,
    request: {
      routine: 'mdm.prospect.promoteToEntity',
      params: { mdmId },
      meta: { source: 'test' },
    },
  });

  assert.equal(loaded.ok, true);
  assert.equal((loaded.data as { details: { name: string } }).details.name, 'Public Lead');
  assert.equal(listed.ok, true);
  assert.deepEqual((listed.data as { items: Array<{ mdmId: string }> }).items.map((item) => item.mdmId), [mdmId]);
  assert.equal(updated.ok, true);
  assert.equal((updated.data as { details: { status: string } }).details.status, 'InProgress');
  assert.equal(promoted.ok, true);
  assert.equal((promoted.data as { promoted: boolean }).promoted, true);
});

test('public relationship handlers reject non-entity scope and invalid unlink payloads', async () => {
  const ctx = createRequestContext();
  const router = createMdmRouter();
  const list = requireHandler(router, 'mdm.relationship.list');
  const update = requireHandler(router, 'mdm.relationship.update');

  for (const scope of ['all', 'prospect']) {
    await assert.rejects(
      () => list({
        ctx,
        request: {
          routine: 'mdm.relationship.list',
          params: {
            entityId: 'entity-1',
            scope,
          },
          meta: { source: 'test' },
        },
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'INVALID_RELATIONSHIP_SCOPE',
    );
  }

  await assert.rejects(
    () => update({
      ctx,
      request: {
        routine: 'mdm.relationship.update',
        params: {
          id: 'relationship-1',
        },
        meta: { source: 'test' },
      },
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_MDM_RELATIONSHIP_UPDATE',
  );
});
