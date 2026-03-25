/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/recordUsecases.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import {
  createEntity,
  createProspect,
  getEntity,
  listEntities,
  mergeEntity,
  promoteProspect,
  updateEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';

test('createEntity deduplicates person by docType and docId', async () => {
  const ctx = createRequestContext();

  const first = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'John Carter',
      status: 'Active',
      docType: 'SSN',
      docId: '123-45-6789',
    },
  });
  const second = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'John Carter Duplicate',
      status: 'Active',
      docType: 'SSN',
      docId: '123456789',
    },
  });

  assert.equal(first.alreadyExists, false);
  assert.equal(second.alreadyExists, true);
  assert.equal(first.mdmId, second.mdmId);
});

test('privacy protected person becomes inactive without consent', async () => {
  const ctx = createRequestContext();

  const created = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Maria Silva',
      status: 'Active',
      countryCode: 'BR',
    },
  });
  const entity = await getEntity(ctx, created.mdmId);

  assert.equal(entity.details.status, 'Inactive');
  assert.equal(entity.index.status, 'Inactive');
});

test('updateEntity enforces optimistic concurrency', async () => {
  const ctx = createRequestContext();

  const created = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Acme Inc',
      legalName: 'Acme Incorporated',
      status: 'Active',
      docType: 'EIN',
      docId: '12-3456789',
    },
  });

  await assert.rejects(
    updateEntity(ctx, {
      mdmId: created.mdmId,
      expectedVersion: 99,
      patch: {
        name: 'Acme Updated',
      },
    }),
    /Version mismatch/,
  );
});

test('promoteProspect preserves mdmId when no duplicate exists', async () => {
  const ctx = createRequestContext();

  const created = await createProspect(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Future Corp',
      legalName: 'Future Corporation',
      status: 'New',
      promotionSource: 'crm',
      docType: 'EIN',
      docId: '98-7654321',
    },
  });

  const promoted = await promoteProspect(ctx, { mdmId: created.mdmId });
  const entity = await getEntity(ctx, created.mdmId);

  assert.equal(promoted.promoted, true);
  assert.equal(entity.index.mdmId, created.mdmId);
});

test('promoteProspect marks pending merge when duplicate exists', async () => {
  const ctx = createRequestContext();

  await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Base Corp',
      legalName: 'Base Corporation',
      status: 'Active',
      docType: 'EIN',
      docId: '55-1111111',
    },
  });
  const createdProspect = await createProspect(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Base Prospect',
      legalName: 'Base Prospect Corporation',
      status: 'New',
      promotionSource: 'crm',
      docType: 'EIN',
      docId: '55-1111111',
    },
  });

  const promoted = await promoteProspect(ctx, { mdmId: createdProspect.mdmId });

  assert.equal(promoted.promoted, false);
  assert.equal(promoted.status, 'PendingMerge');
});

test('mergeEntity keeps loser as tombstone', async () => {
  const ctx = createRequestContext();

  const winner = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Winner Corp',
      legalName: 'Winner Corporation',
      status: 'Active',
    },
  });
  const loser = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Loser Corp',
      legalName: 'Loser Corporation',
      status: 'Active',
    },
  });

  await mergeEntity(ctx, {
    winnerMdmId: winner.mdmId,
    loserMdmId: loser.mdmId,
  });
  const loserEntity = await getEntity(ctx, loser.mdmId);

  assert.equal(loserEntity.details.status, 'Merged');
  assert.equal(loserEntity.details.mergedInto, winner.mdmId);
});

test('createEntity stores a person user detail with addresses and aliases', async () => {
  const ctx = createRequestContext();

  const created = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: 'Ana Souza',
      status: 'Active',
      countryCode: 'BR',
      aliases: ['Ana S'],
      addresses: [
        {
          type: 'Residential',
          line1: 'Rua A, 100',
          city: 'Sao Paulo',
          countryCode: 'BR',
          isPrimary: true,
        },
      ],
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'web-signup',
      },
    },
  });
  const entity = await getEntity(ctx, created.mdmId);

  assert.equal(entity.details.subtype, 'Person');
  assert.equal(entity.details.name, 'Ana Souza');
  assert.equal(entity.details.countryCode, 'BR');
  assert.deepEqual(entity.details.aliases, ['Ana S']);
  assert.equal(entity.details.addresses.length, 1);
  assert.equal(entity.index.status, 'Active');
});

test('createEntity defaults companyKind and serviceKind for company and service records', async () => {
  const ctx = createRequestContext();

  const company = await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Org Root',
      legalName: 'Org Root LLC',
      status: 'Active',
    },
  });
  const service = await createEntity(ctx, {
    detail: {
      subtype: 'Service',
      name: 'General Service',
      status: 'Active',
    },
  });

  const companyDetails = (await getEntity(ctx, company.mdmId)).details;
  const serviceDetails = (await getEntity(ctx, service.mdmId)).details;

  assert.equal(companyDetails.subtype, 'Company');
  assert.equal(companyDetails.companyKind, 'LegalEntity');
  assert.equal(serviceDetails.subtype, 'Service');
  assert.equal(serviceDetails.serviceKind, 'Service');
});

test('listEntities supports orderBy and limit in memory runtime', async () => {
  const ctx = createRequestContext();

  await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Zulu Corp',
      legalName: 'Zulu Corporation',
      status: 'Active',
    },
  });
  await createEntity(ctx, {
    detail: {
      subtype: 'Company',
      name: 'Alpha Corp',
      legalName: 'Alpha Corporation',
      status: 'Active',
    },
  });

  const result = await listEntities(ctx, {
    subtype: 'Company',
    orderBy: {
      field: 'name',
      direction: 'asc',
    },
    limit: 1,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.name, 'Alpha Corp');
});
