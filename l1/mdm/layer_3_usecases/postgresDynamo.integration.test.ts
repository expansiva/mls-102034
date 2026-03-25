/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/postgresDynamo.integration.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { MdmAuditLogRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmAuditLogRemoteRuntimeDynamo.js';
import { MdmCommentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmCommentRemoteRuntimeDynamo.js';
import { MdmDocumentRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmDocumentRemoteRuntimeDynamo.js';
import { MdmNumberSequenceRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmNumberSequenceRemoteRuntimeDynamo.js';
import { MdmRelationshipRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmRelationshipRemoteRuntimeDynamo.js';
import { MdmTagRemoteRuntimeDynamo } from '/_102034_/l1/mdm/layer_1_external/data/dynamodb/MdmTagRemoteRuntimeDynamo.js';
import { WriteBehindWorker } from '/_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.js';
import { RestoreFromDynamoUsecase } from '/_102034_/l1/mdm/layer_1_external/queue/RestoreFromDynamoUsecase.js';
import {
  createEntity,
  createProspect,
  mergeEntity,
  promoteProspect,
  updateEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/recordUsecases.js';
import {
  createRelationship,
  updateRelationship,
} from '/_102034_/l1/mdm/layer_3_usecases/relationshipUsecases.js';
import { addComment } from '/_102034_/l1/mdm/layer_3_usecases/commentUsecases.js';
import { nextSequence } from '/_102034_/l1/mdm/layer_3_usecases/numberSequenceUsecases.js';
import { findLatestStatusByEntity } from '/_102034_/l1/mdm/layer_3_usecases/statusHistoryUsecases.js';
import { addTag } from '/_102034_/l1/mdm/layer_3_usecases/tagUsecases.js';
import { runMigrations } from '/_102034_/l1/scripts/migrate.js';
import { ensureDynamoTable } from '/_102034_/l1/scripts/ensureDynamoTable.js';

const shouldRunIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';

const env = readAppEnv();
const runtime = createPostgresDataRuntime(env);
const remoteAuditRuntime = new MdmAuditLogRemoteRuntimeDynamo(env);
const remoteCommentRuntime = new MdmCommentRemoteRuntimeDynamo(env);
const remoteRuntime = new MdmDocumentRemoteRuntimeDynamo(env);
const remoteNumberSequenceRuntime = new MdmNumberSequenceRemoteRuntimeDynamo(env);
const remoteRelationshipRuntime = new MdmRelationshipRemoteRuntimeDynamo(env);
const remoteTagRuntime = new MdmTagRemoteRuntimeDynamo(env);
const worker = new WriteBehindWorker(env);
const restoreUsecase = new RestoreFromDynamoUsecase(env);
const ctx = createRequestContext(runtime);

let integrationCounter = 0;
let integrationInfrastructureReady = false;

function nextSuffix(): string {
  integrationCounter += 1;
  return `${Date.now()}-${integrationCounter}`;
}

function buildCompanyInput(namePrefix: string) {
  const suffix = nextSuffix();
  return {
    subtype: 'Company' as const,
    name: `${namePrefix} ${suffix}`,
    legalName: `${namePrefix} ${suffix} LTDA`,
    status: 'Active' as const,
    docType: 'EIN' as const,
    docId: suffix.replace(/[^\d]/g, '').slice(-9),
    countryCode: 'US',
    tags: ['integration', namePrefix.toLowerCase()],
  };
}

async function flushWriteBehind(limit = 50) {
  const result = await worker.runOnce(limit);
  return result;
}

async function ensureIntegrationInfrastructure() {
  if (integrationInfrastructureReady) {
    return;
  }

  await runMigrations();
  await ensureDynamoTable();
  integrationInfrastructureReady = true;
}

async function assertRemoteDocument(
  mdmId: string,
  expected: (document: NonNullable<Awaited<ReturnType<typeof remoteRuntime.get>>>) => void,
) {
  const remoteDocument = await remoteRuntime.get(mdmId);
  assert.ok(remoteDocument);
  expected(remoteDocument);
}

test('postgres and dynamodb integration - create entity and replicate document', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const created = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Create'),
  });

  assert.equal(created.alreadyExists, false);

  const indexRow = await runtime.mdmEntityIndex.findOne({
    where: { mdmId: created.mdmId },
  });
  const cacheRow = await runtime.mdmDocument.get({ mdmId: created.mdmId });
  const outboxRows = await runtime.mdmOutbox.findMany({
    where: { aggregateId: created.mdmId },
  });

  assert.ok(indexRow);
  assert.ok(cacheRow);
  assert.equal(typeof cacheRow?.details, 'object');
  assert.equal(outboxRows.length > 0, true);

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  await assertRemoteDocument(created.mdmId, (document) => {
    assert.equal(document.mdmId, created.mdmId);
    assert.equal(typeof document.details, 'object');
    assert.equal(document.details.subtype, 'Company');
  });
});

test('postgres and dynamodb integration - update entity increments version and syncs remote document', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const created = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Update'),
  });
  await flushWriteBehind();
  const newName = `Updated ${nextSuffix()}`;

  const updated = await updateEntity(ctx, {
    mdmId: created.mdmId,
    expectedVersion: 1,
    patch: {
      name: newName,
      tags: ['integration', 'updated'],
    },
  });

  assert.equal(updated.version, 2);
  const cacheRow = await runtime.mdmDocument.get({ mdmId: created.mdmId });
  assert.ok(cacheRow);
  assert.equal(cacheRow?.version, 2);
  assert.equal(cacheRow?.details.name, newName);

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  await assertRemoteDocument(created.mdmId, (document) => {
    assert.equal(document.version, 2);
    assert.equal(document.details.name, newName);
    assert.deepEqual(document.details.tags, ['integration', 'updated']);
  });

  const auditRows = await runtime.mdmAuditLog.findMany({
    where: { entityType: 'MdmEntity', entityId: created.mdmId, action: 'update' },
  });
  assert.equal(auditRows.length > 0, true);
  const remoteAudit = await remoteAuditRuntime.get(auditRows[0]!.id);
  assert.ok(remoteAudit);
  assert.equal(remoteAudit?.diff?.some((entry) => entry.path.join('.') === 'details.name'), true);
  const monitorRows = await runtime.mdmMonitoringWrite.findMany({
    where: { entityType: 'MdmEntity', entityId: created.mdmId, action: 'update', success: true },
  });
  assert.equal(monitorRows.length > 0, true);
});

test('postgres integration - failed update writes monitoring failure and error log', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const created = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Conflict'),
  });

  await assert.rejects(
    () => updateEntity(ctx, {
      mdmId: created.mdmId,
      expectedVersion: 999,
      patch: {
        name: `Conflict ${nextSuffix()}`,
      },
    }),
  );

  const errorRows = await runtime.mdmErrorLog.findMany({
    where: { entityType: 'MdmEntity', entityId: created.mdmId, action: 'update' },
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 1,
  });
  assert.equal(errorRows.length, 1);
  assert.equal(errorRows[0]?.errorCode, 'CONCURRENCY_CONFLICT');

  const monitorRows = await runtime.mdmMonitoringWrite.findMany({
    where: { entityType: 'MdmEntity', entityId: created.mdmId, action: 'update', success: false },
  });
  assert.equal(monitorRows.length > 0, true);
});

test('postgres and dynamodb integration - promote prospect without duplicate preserves mdmId', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const createdProspect = await createProspect(ctx, {
    detail: {
      ...buildCompanyInput('Integration Prospect Promote'),
      status: 'New',
      promotionSource: 'integration-test',
    },
  });

  const promoted = await promoteProspect(ctx, { mdmId: createdProspect.mdmId });

  assert.equal(promoted.promoted, true);
  assert.equal(promoted.mdmId, createdProspect.mdmId);

  const entityRow = await runtime.mdmEntityIndex.findOne({
    where: { mdmId: createdProspect.mdmId },
  });
  const prospectRow = await runtime.mdmProspectIndex.findOne({
    where: { mdmId: createdProspect.mdmId },
  });

  assert.ok(entityRow);
  assert.equal(prospectRow, null);

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  await assertRemoteDocument(createdProspect.mdmId, (document) => {
    assert.equal(document.details.status, 'Active');
    assert.equal(document.details.promotedTo, createdProspect.mdmId);
  });
});

test('postgres and dynamodb integration - promote prospect with duplicate marks pending merge and emits queue event', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const duplicateSource = buildCompanyInput('Integration Duplicate Source');
  const existingEntity = await createEntity(ctx, {
    detail: duplicateSource,
  });

  const createdProspect = await createProspect(ctx, {
    detail: {
      ...duplicateSource,
      name: `${duplicateSource.name} Prospect`,
      legalName: `${duplicateSource.legalName} Prospect`,
      status: 'New',
      promotionSource: 'integration-test',
    },
  });

  const promoted = await promoteProspect(ctx, { mdmId: createdProspect.mdmId });

  assert.equal(promoted.promoted, false);
  assert.equal(promoted.status, 'PendingMerge');
  assert.equal(promoted.candidateMdmId, existingEntity.mdmId);

  const prospectRow = await runtime.mdmProspectIndex.findOne({
    where: { mdmId: createdProspect.mdmId },
  });
  const queueRows = await runtime.pgQueue.list({ topic: 'mdm.pending-merge' });

  assert.ok(prospectRow);
  assert.equal(prospectRow?.status, 'PendingMerge');
  assert.equal(
    queueRows.some((item) => {
      const payload = item.payload as { prospectMdmId?: string; entityMdmId?: string };
      return payload.prospectMdmId === createdProspect.mdmId && payload.entityMdmId === existingEntity.mdmId;
    }),
    true,
  );

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  await assertRemoteDocument(createdProspect.mdmId, (document) => {
    assert.equal(document.details.status, 'PendingMerge');
    assert.equal(document.details.promotedTo, existingEntity.mdmId);
  });
});

test('postgres and dynamodb integration - merge entity writes tombstone and syncs remote document', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const winner = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Merge Winner'),
  });
  const loser = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Merge Loser'),
  });
  await flushWriteBehind();

  const merged = await mergeEntity(ctx, {
    winnerMdmId: winner.mdmId,
    loserMdmId: loser.mdmId,
  });

  assert.equal(merged.status, 'Merged');
  const loserRow = await runtime.mdmEntityIndex.findOne({
    where: { mdmId: loser.mdmId },
  });
  assert.ok(loserRow);
  assert.equal(loserRow?.status, 'Merged');
  assert.equal(loserRow?.mergedInto, winner.mdmId);

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  await assertRemoteDocument(loser.mdmId, (document) => {
    assert.equal(document.details.status, 'Merged');
    assert.equal(document.details.mergedInto, winner.mdmId);
  });
});

test('postgres and dynamodb integration - restore from dynamodb rebuilds local cache and index', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const created = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Restore'),
  });
  await flushWriteBehind();

  await runtime.runInTransaction(async (trx) => {
    await trx.mdmEntityIndex.delete({ where: { mdmId: created.mdmId } });
    await trx.mdmDocument.delete({ mdmId: created.mdmId });
  });

  const missingLocalIndex = await runtime.mdmEntityIndex.findOne({
    where: { mdmId: created.mdmId },
  });
  const missingLocalCache = await runtime.mdmDocument.get({ mdmId: created.mdmId });

  assert.equal(missingLocalIndex, null);
  assert.equal(missingLocalCache, null);

  await restoreUsecase.restoreById(created.mdmId);

  const restoredIndex = await runtime.mdmEntityIndex.findOne({
    where: { mdmId: created.mdmId },
  });
  const restoredCache = await runtime.mdmDocument.get({ mdmId: created.mdmId });

  assert.ok(restoredIndex);
  assert.ok(restoredCache);
  assert.equal(restoredCache?.details.mdmId, created.mdmId);
  assert.equal(restoredCache?.details.subtype, 'Company');
});

test('postgres and dynamodb integration - relationship refs sync to postgres cache and dynamodb', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const company = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Relationship Company'),
  });
  const employee = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: `Integration Employee ${nextSuffix()}`,
      status: 'Active',
      countryCode: 'US',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'integration',
      },
    },
  });

  const created = await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employee.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });

  const companyCache = await runtime.mdmDocument.get({ mdmId: company.mdmId });
  const employeeCache = await runtime.mdmDocument.get({ mdmId: employee.mdmId });

  assert.deepEqual(companyCache?.details.relationshipRefs.employees, [employee.mdmId]);
  assert.deepEqual(employeeCache?.details.relationshipRefs.employers, [company.mdmId]);

  await flushWriteBehind();

  await assertRemoteDocument(company.mdmId, (document) => {
    assert.deepEqual(document.details.relationshipRefs.employees, [employee.mdmId]);
  });
  await assertRemoteDocument(employee.mdmId, (document) => {
    assert.deepEqual(document.details.relationshipRefs.employers, [company.mdmId]);
  });
  const remoteRelationships = await remoteRelationshipRuntime.listAll('entity');
  assert.equal(
    remoteRelationships.some(
      (relationship) =>
        relationship.id === created.relationship.id &&
        relationship.scope === 'entity' &&
        relationship.fromId === company.mdmId &&
        relationship.toId === employee.mdmId,
    ),
    true,
  );

  await updateRelationship(ctx, {
    id: created.relationship.id,
    patch: {
      status: 'Inactive',
    },
  });
  await flushWriteBehind();

  await assertRemoteDocument(company.mdmId, (document) => {
    assert.equal(document.details.relationshipRefs.employees, undefined);
  });
});

test('postgres and dynamodb integration - restore all relationships rebuilds local tables', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const company = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Restore Relationship Company'),
  });
  const employee = await createEntity(ctx, {
    detail: {
      subtype: 'Person',
      name: `Integration Restore Employee ${nextSuffix()}`,
      status: 'Active',
      countryCode: 'US',
      privacyConsent: {
        consentedAt: '2026-03-18T10:00:00.000Z',
        consentVersion: 'v1',
        channel: 'integration',
      },
    },
  });

  const created = await createRelationship(ctx, {
    fromId: company.mdmId,
    toId: employee.mdmId,
    type: 'Employs',
    validFrom: '2026-03-18',
  });
  await flushWriteBehind();

  await runtime.mdmRelationship.delete({ where: { id: created.relationship.id } });
  const missingRelationship = await runtime.mdmRelationship.findOne({
    where: { id: created.relationship.id },
  });
  assert.equal(missingRelationship, null);

  const restoredCount = await restoreUsecase.restoreAllRelationships();
  assert.equal(restoredCount >= 1, true);

  const restoredRelationship = await runtime.mdmRelationship.findOne({
    where: { id: created.relationship.id },
  });
  assert.ok(restoredRelationship);
  assert.equal(restoredRelationship?.fromId, company.mdmId);
  assert.equal(restoredRelationship?.toId, employee.mdmId);
});

test('postgres integration - monitor snapshot tracks global BFF executions', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const created = await execBff(
    {
      routine: 'mdm.entity.create',
      params: {
        detail: buildCompanyInput('Integration Monitor'),
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );
  const missing = await execBff(
    {
      routine: 'mdm.entity.get',
      params: {
        mdmId: `missing-${nextSuffix()}`,
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );
  const snapshot = await execBff(
    {
      routine: 'monitor.monitorGetStatistics.getSnapshot',
      params: {},
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  assert.equal(created.statusCode, 200);
  assert.equal(missing.statusCode, 404);
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.response.ok, true);
  if (!snapshot.response.ok || !snapshot.response.data) {
    throw new Error('Expected monitor snapshot response');
  }

  const snapshotData = snapshot.response.data as {
    storage: {
      postgres: {
        tables: Array<{ tableName: string; exists: boolean; rowCount: number | null }>;
      };
      dynamodb: {
        tables: Array<{ tableName: string; exists: boolean }>;
      };
    };
    bff: {
      overview: {
        totalExecutions: number;
        successCount: number;
        notFoundCount: number;
      };
      byRoutine: Array<{ routine: string; totalCount: number }>;
      recentFailures: Array<{ routine: string; statusCode: number }>;
    };
    counts: {
      postgresIndexes: {
        monitorBffExecutionLog: number;
      };
    };
  };

  assert.equal(
    snapshotData.storage.postgres.tables.some((table) => table.tableName === 'monitor_bff_execution_log' && table.exists),
    true,
  );
  assert.equal(
    snapshotData.storage.dynamodb.tables.some((table) => table.tableName === env.dynamoTableMdm),
    true,
  );
  assert.equal(snapshotData.bff.overview.totalExecutions >= 2, true);
  assert.equal(snapshotData.bff.overview.successCount >= 1, true);
  assert.equal(snapshotData.bff.overview.notFoundCount >= 1, true);
  assert.equal(
    snapshotData.bff.byRoutine.some((item) => item.routine === 'mdm.entity.create'),
    true,
  );
  assert.equal(
    snapshotData.bff.recentFailures.some((item) => item.routine === 'mdm.entity.get' && item.statusCode === 404),
    true,
  );
  assert.equal(snapshotData.counts.postgresIndexes.monitorBffExecutionLog >= 2, true);
});

test('postgres and dynamodb integration - tag add stores locally and replicates remotely', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const entity = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Tag'),
  });

  const added = await addTag(ctx, {
    entityType: 'MdmEntity',
    entityId: entity.mdmId,
    tag: 'VIP',
    module: 'purchasing',
  });

  assert.equal(added.alreadyExists, false);
  const localRow = await runtime.mdmTag.findOne({
    where: { id: added.tag.id },
  });
  assert.ok(localRow);
  assert.equal(localRow?.tag, 'vip');

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  const remoteRow = await remoteTagRuntime.get(added.tag.id);
  assert.ok(remoteRow);
  assert.equal(remoteRow?.tag, 'vip');
  assert.equal(remoteRow?.module, 'purchasing');
});

test('postgres and dynamodb integration - comment add stores locally and replicates remotely', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const entity = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Comment'),
  });

  const created = await addComment(ctx, {
    entityType: 'MdmEntity',
    entityId: entity.mdmId,
    text: 'Integration note',
    module: 'purchasing',
  });

  const localRow = await runtime.mdmComment.findOne({ where: { id: created.id } });
  assert.ok(localRow);
  assert.equal(localRow?.text, 'Integration note');

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  const remoteRow = await remoteCommentRuntime.get(created.id);
  assert.ok(remoteRow);
  assert.equal(remoteRow?.text, 'Integration note');
});

test('postgres and dynamodb integration - number sequence next stores locally and replicates remotely', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const result = await nextSequence(ctx, {
    sequenceKey: `purchasing.PurchaseOrder.global.${nextSuffix()}`,
    prefix: 'PO-',
    scopeType: 'global',
    padding: 4,
  });

  assert.equal(result.value.startsWith('PO-'), true);
  const localRow = await runtime.mdmNumberSequence.findOne({ where: { id: result.record.id } });
  assert.ok(localRow);
  assert.equal(localRow?.currentValue, 1);

  const workerResult = await flushWriteBehind();
  assert.equal(workerResult.processed >= 1, true);

  const remoteRow = await remoteNumberSequenceRuntime.get(result.record.id);
  assert.ok(remoteRow);
  assert.equal(remoteRow?.currentValue, 1);
});

test('postgres integration - status history query returns latest merged status', async (t) => {
  if (!shouldRunIntegration) {
    t.skip('Set RUN_INTEGRATION_TESTS=true to enable real integration tests');
    return;
  }

  await ensureIntegrationInfrastructure();
  const winner = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Status Winner'),
  });
  const loser = await createEntity(ctx, {
    detail: buildCompanyInput('Integration Status Loser'),
  });

  await mergeEntity(ctx, {
    winnerMdmId: winner.mdmId,
    loserMdmId: loser.mdmId,
  });

  const latest = await findLatestStatusByEntity(ctx, {
    entityType: 'MdmEntity',
    entityId: loser.mdmId,
  });

  assert.ok(latest);
  assert.equal(latest?.toStatus, 'Merged');
});
