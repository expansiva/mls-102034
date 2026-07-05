/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/mdmFacade.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';

test('MdmEntity.create writes document and promoted index for canonical module type listing', async () => {
  const ctx = createRequestContext();

  const table = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Table 1',
      tags: ['cafeFlow'],
      moduleTypes: ['cafeFlow.Table'],
      cafeFlow: {
        kind: 'Table',
        seats: 4,
      },
    },
  });
  await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Kitchen',
      moduleTypes: ['cafeFlow.KitchenArea'],
      cafeFlow: {
        kind: 'KitchenArea',
      },
    },
  });
  await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Espresso',
      moduleTypes: ['cafeFlow.MenuItem'],
      cafeFlow: {
        kind: 'MenuItem',
      },
    },
  });

  const document = await ctx.data.mdmDocument.get({ mdmId: table.mdmId });
  const index = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId: table.mdmId } });
  const listed = await ctx.mdm.collection.listByType({ type: 'cafeFlow.Table' });

  assert.equal(document?.details.mdmId, table.mdmId);
  assert.equal(index?.mdmId, table.mdmId);
  assert.deepEqual(document?.details.moduleTypes, ['cafeFlow.Table']);
  assert.equal(index?.tags.includes('cafeFlow.Table'), true);
  assert.deepEqual(listed.items.map((item) => item.mdmId), [table.mdmId]);
});

test('MdmEntity.update keeps document and index fields consistent and enforces expectedVersion', async () => {
  const ctx = createRequestContext();
  ctx.log.error = () => undefined;
  const created = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Old Item',
      tags: ['catalog'],
      moduleTypes: ['cafeFlow.MenuItem'],
    },
  });

  await assert.rejects(
    ctx.mdm.entity.update({
      mdmId: created.mdmId,
      expectedVersion: 99,
      patch: {
        name: 'Conflict Item',
      },
    }),
    /Version mismatch/,
  );

  const updated = await ctx.mdm.entity.update({
    mdmId: created.mdmId,
    expectedVersion: created.version,
    patch: {
      name: 'Updated Item',
      status: 'Inactive',
      tags: ['catalog', 'archived'],
      moduleTypes: ['cafeFlow.StockItem'],
    },
  });
  const oldType = await ctx.mdm.collection.listByType({ type: 'cafeFlow.MenuItem' });
  const newType = await ctx.mdm.collection.listByType({
    type: 'cafeFlow.StockItem',
    status: 'Inactive',
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.details.name, 'Updated Item');
  assert.equal(updated.index.name, 'Updated Item');
  assert.equal(updated.details.status, 'Inactive');
  assert.equal(updated.index.status, 'Inactive');
  assert.deepEqual(updated.details.moduleTypes, ['cafeFlow.StockItem']);
  assert.equal(updated.index.tags.includes('cafeFlow.StockItem'), true);
  assert.equal(oldType.total, 0);
  assert.deepEqual(newType.items.map((item) => item.mdmId), [created.mdmId]);
});

test('MdmProspect supports create, update, listByType and promoteToEntity through explicit facade', async () => {
  const ctx = createRequestContext(createMemoryDataRuntime());
  const created = await ctx.mdm.prospect.create({
    details: {
      subtype: 'Company',
      name: 'Qualified Lead',
      legalName: 'Qualified Lead LLC',
      moduleTypes: ['crm.Lead'],
      tags: ['pipeline'],
      promotionSource: 'landing-page',
    },
  });

  const listed = await ctx.mdm.prospect.listByType({
    type: 'crm.Lead',
    status: 'New',
  });
  const updated = await ctx.mdm.prospect.update({
    mdmId: created.mdmId,
    expectedVersion: created.version,
    patch: {
      status: 'InProgress',
      tags: ['pipeline', 'sales-qualified'],
    },
  });
  const promoted = await ctx.mdm.prospect.promoteToEntity({ mdmId: created.mdmId });
  const entityIndex = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId: created.mdmId } });
  const prospectIndex = await ctx.data.mdmProspectIndex.findOne({ where: { mdmId: created.mdmId } });

  assert.equal(created.details.status, 'New');
  assert.equal(created.index.tags.includes('crm.Lead'), true);
  assert.deepEqual(listed.items.map((item) => item.mdmId), [created.mdmId]);
  assert.equal(updated.version, 2);
  assert.equal(updated.details.status, 'InProgress');
  assert.equal(updated.index.status, 'InProgress');
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.mdmId, created.mdmId);
  assert.equal(entityIndex?.tags.includes('crm.Lead'), true);
  assert.equal(prospectIndex, null);
});

test('MdmEntity.link writes relationship rows and refreshes relationshipRefs on both documents', async () => {
  const ctx = createRequestContext();
  const restaurant = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Main Restaurant',
      moduleTypes: ['cafeFlow.Restaurant'],
    },
  });
  const table = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Table 2',
      moduleTypes: ['cafeFlow.Table'],
    },
  });

  const linked = await ctx.mdm.entity.link({
    fromId: table.mdmId,
    toId: restaurant.mdmId,
    type: 'LocatedAt',
  });
  const relationship = await ctx.data.mdmRelationship.findOne({
    where: { id: linked.relationship.id },
  });
  const hydratedTable = await ctx.mdm.entity.get({ mdmId: table.mdmId });
  const hydratedRestaurant = await ctx.mdm.entity.get({ mdmId: restaurant.mdmId });
  const related = await ctx.mdm.collection.relatedOfMany({
    mdmIds: [table.mdmId, restaurant.mdmId],
    type: 'LocatedAt',
  });

  assert.equal(relationship?.fromId, table.mdmId);
  assert.deepEqual(hydratedTable.details.relationshipRefs.locations, [restaurant.mdmId]);
  assert.deepEqual(hydratedRestaurant.details.relationshipRefs.locatedEntities, [table.mdmId]);
  assert.deepEqual(hydratedTable.related('locations'), [restaurant.mdmId]);
  assert.deepEqual(related[table.mdmId]?.map((item) => item.mdmId), [restaurant.mdmId]);
  assert.deepEqual(related[restaurant.mdmId]?.map((item) => item.mdmId), [table.mdmId]);
});

test('MdmEntity.link rejects prospect endpoints on the public facade', async () => {
  const ctx = createRequestContext();
  const restaurant = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Permanent Restaurant',
      moduleTypes: ['cafeFlow.Restaurant'],
    },
  });
  const prospect = await ctx.mdm.prospect.create({
    details: {
      subtype: 'Location',
      name: 'Prospect Table',
      moduleTypes: ['cafeFlow.Table'],
    },
  });

  await assert.rejects(
    () => ctx.mdm.entity.link({
      fromId: prospect.mdmId,
      toId: restaurant.mdmId,
      type: 'LocatedAt',
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_RELATIONSHIP_SCOPE',
  );
});

test('MdmEntity.unlink removes relationshipRefs without deleting the relationship audit row', async () => {
  const ctx = createRequestContext();
  const restaurant = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Unlink Restaurant',
      moduleTypes: ['cafeFlow.Restaurant'],
    },
  });
  const table = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Unlink Table',
      moduleTypes: ['cafeFlow.Table'],
    },
  });
  const linked = await ctx.mdm.entity.link({
    fromId: table.mdmId,
    toId: restaurant.mdmId,
    type: 'LocatedAt',
  });

  await ctx.mdm.entity.unlink({ relationshipId: linked.relationship.id });
  const relationship = await ctx.data.mdmRelationship.findOne({
    where: { id: linked.relationship.id },
  });
  const hydratedTable = await ctx.mdm.entity.get({ mdmId: table.mdmId });
  const hydratedRestaurant = await ctx.mdm.entity.get({ mdmId: restaurant.mdmId });

  assert.equal(relationship?.status, 'Inactive');
  assert.equal(hydratedTable.details.relationshipRefs.locations, undefined);
  assert.equal(hydratedRestaurant.details.relationshipRefs.locatedEntities, undefined);
});

test('MdmCollection.getMany preserves requested order, chunks reads and handles empty input', async () => {
  const ctx = createRequestContext();
  const first = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'First',
      moduleTypes: ['cafeFlow.MenuItem'],
    },
  });
  const second = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Second',
      moduleTypes: ['cafeFlow.MenuItem'],
    },
  });
  const third = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Third',
      moduleTypes: ['cafeFlow.MenuItem'],
    },
  });
  const batches: string[][] = [];
  const originalGetMany = ctx.data.mdmDocument.getMany.bind(ctx.data.mdmDocument);
  ctx.data.mdmDocument.getMany = async (input) => {
    batches.push([...input.mdmIds]);
    return originalGetMany(input);
  };

  const empty = await ctx.mdm.collection.getMany({ mdmIds: [] });
  const records = await ctx.mdm.collection.getMany({
    mdmIds: [third.mdmId, first.mdmId, 'missing-id', second.mdmId],
    chunkSize: 2,
  });

  assert.deepEqual(empty, []);
  assert.deepEqual(records.map((record) => record.mdmId), [third.mdmId, first.mdmId, second.mdmId]);
  assert.deepEqual(batches, [
    [third.mdmId, first.mdmId],
    ['missing-id', second.mdmId],
  ]);
});

test('MdmCollection.hydrateMany uses getMany and can return selected detail sections only', async () => {
  const ctx = createRequestContext();
  const created = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Latte',
      moduleTypes: ['cafeFlow.MenuItem'],
      cafeFlow: {
        price: 12,
      },
      inventory: {
        cost: 4,
      },
    },
  });

  const hydrated = await ctx.mdm.collection.hydrateMany({
    mdmIds: [created.mdmId],
    sections: ['cafeFlow'],
  });
  const details = hydrated[0]?.details as Record<string, unknown>;

  assert.equal(hydrated.length, 1);
  assert.deepEqual(details.cafeFlow, { price: 12 });
  assert.equal('inventory' in details, false);
  assert.deepEqual(details.relationshipRefs, {});
});

test('MdmEntity.delete removes standalone entity and blocks active relationships by default', async () => {
  const ctx = createRequestContext();
  const standalone = await ctx.mdm.entity.create({
    details: {
      subtype: 'Product',
      name: 'Delete Me',
      moduleTypes: ['cafeFlow.MenuItem'],
    },
  });

  await ctx.mdm.entity.delete({ mdmId: standalone.mdmId });
  assert.equal(await ctx.data.mdmDocument.get({ mdmId: standalone.mdmId }), null);
  assert.equal(await ctx.data.mdmEntityIndex.findOne({ where: { mdmId: standalone.mdmId } }), null);

  const restaurant = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Delete Block Restaurant',
      moduleTypes: ['cafeFlow.Restaurant'],
    },
  });
  const table = await ctx.mdm.entity.create({
    details: {
      subtype: 'Location',
      name: 'Delete Block Table',
      moduleTypes: ['cafeFlow.Table'],
    },
  });
  await ctx.mdm.entity.link({
    fromId: table.mdmId,
    toId: restaurant.mdmId,
    type: 'LocatedAt',
  });

  await assert.rejects(
    ctx.mdm.entity.delete({ mdmId: table.mdmId }),
    /active relationships/,
  );
  const inactivated = await ctx.mdm.entity.inactivate({
    mdmId: table.mdmId,
    expectedVersion: (await ctx.mdm.entity.get({ mdmId: table.mdmId })).version,
  });

  assert.equal(inactivated.details.status, 'Inactive');
  assert.equal(inactivated.index.status, 'Inactive');
});
