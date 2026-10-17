/// <mls fileReference="_102034_/l1/workflow/occurrenceRecordId.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import type { MdmEntityIndexRecord } from '/_102034_/l1/mdm/module.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { clearRepositories, registerRepository, resolveRepository } from '/_102034_/l1/server/layer_2_application/repositoryRegistry.js';
import { createOccurrenceContext, occurrenceRecordId } from '/_102034_/l1/workflow/occurrenceRecordId.js';

function requestCtx(): RequestContext {
  const ctx = createRequestContext();
  ctx.moduleId = 'tarefas';
  ctx.sessionContext.project.projectId = '10';
  ctx.sessionContext.person = { mdmId: 'person-1', email: 'a@b.c', name: 'Ada' };
  ctx.sessionContext.actorSession.actorId = 'actor-must-not-affect-id';
  ctx.requestMeta = { requestId: 'req-1', userId: 'telemetry-user', source: 'test' };
  return ctx;
}

function expected(parts: {
  project: string;
  moduleId: string;
  processId: string;
  person: string | null;
  tail: ['request', string] | ['explicit', string];
}): string {
  const tuple = ['workflow-record-v1', parts.project, parts.moduleId, parts.processId, parts.person, parts.tail];
  return `wf_${createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex')}`;
}

test('the same scope and key stay stable and ignore telemetry userId and actorId', () => {
  const ctx = requestCtx();
  const first = occurrenceRecordId(ctx, 'ciclo');
  ctx.requestMeta = { ...ctx.requestMeta, userId: 'someone-else' };
  ctx.sessionContext.actorSession.actorId = 'other-actor';
  const second = occurrenceRecordId(ctx, 'ciclo');
  assert.equal(first, second);
  assert.equal(first, expected({
    project: '10',
    moduleId: 'tarefas',
    processId: 'ciclo',
    person: 'person-1',
    tail: ['request', 'req-1'],
  }));
  assert.match(first, /^wf_[0-9a-f]{64}$/u);
});

test('person, project, module, process, seed and awkward separators each change the id', () => {
  const ctx = requestCtx();
  const base = occurrenceRecordId(ctx, 'ciclo');
  const otherPerson = requestCtx();
  otherPerson.sessionContext.person = { mdmId: 'person-2', email: 'b@b.c', name: 'Bea' };
  const otherProject = requestCtx();
  otherProject.sessionContext.project.projectId = '11';
  const otherModule = requestCtx();
  otherModule.moduleId = 'compras';
  const otherRequest = requestCtx();
  otherRequest.requestMeta = { requestId: 'req-2', userId: 'telemetry-user', source: 'test' };
  assert.notEqual(occurrenceRecordId(otherPerson, 'ciclo'), base);
  assert.notEqual(occurrenceRecordId(otherProject, 'ciclo'), base);
  assert.notEqual(occurrenceRecordId(otherModule, 'ciclo'), base);
  assert.notEqual(occurrenceRecordId(ctx, 'outro'), base);
  assert.notEqual(occurrenceRecordId(otherRequest, 'ciclo'), base);
  assert.notEqual(occurrenceRecordId(ctx, 'ciclo', 'seed-a'), base);
  assert.notEqual(occurrenceRecordId(ctx, 'ciclo', 'seed-a'), occurrenceRecordId(ctx, 'ciclo', 'seed-b'));

  const left = requestCtx();
  left.sessionContext.project.projectId = 'a|b';
  left.moduleId = 'c"d';
  const right = requestCtx();
  right.sessionContext.project.projectId = 'a';
  right.moduleId = '|b';
  assert.notEqual(occurrenceRecordId(left, 'c"d'), occurrenceRecordId(right, 'c"d'));
  assert.equal(occurrenceRecordId(left, 'p|q'), expected({
    project: 'a|b',
    moduleId: 'c"d',
    processId: 'p|q',
    person: 'person-1',
    tail: ['request', 'req-1'],
  }));
});

test('missing scope fails and a tick seed is stable without a person or requestId', () => {
  const missingProject = requestCtx();
  missingProject.sessionContext.project.projectId = '  ';
  const missingModule = requestCtx();
  missingModule.moduleId = undefined;
  const missingPerson = requestCtx();
  missingPerson.sessionContext.person = undefined;
  const missingRequest = requestCtx();
  missingRequest.requestMeta = { userId: 'telemetry-user', source: 'test' };
  for (const run of [
    () => occurrenceRecordId(missingProject, 'ciclo'),
    () => occurrenceRecordId(missingModule, 'ciclo'),
    () => occurrenceRecordId(requestCtx(), '  '),
    () => occurrenceRecordId(missingPerson, 'ciclo'),
    () => occurrenceRecordId(missingRequest, 'ciclo'),
    () => occurrenceRecordId(missingPerson, 'ciclo', '   '),
  ]) {
    assert.throws(run, (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR' && error.statusCode === 400);
  }

  const tick = requestCtx();
  tick.sessionContext.person = undefined;
  tick.requestMeta = { userId: 'telemetry-only', source: 'message' };
  const seed = 'ciclo|2026-10-17|resp-1';
  const id = occurrenceRecordId(tick, 'ciclo', seed);
  assert.equal(occurrenceRecordId(tick, 'ciclo', seed), id);
  assert.equal(id, expected({
    project: '10',
    moduleId: 'tarefas',
    processId: 'ciclo',
    person: null,
    tail: ['explicit', seed],
  }));
  const withPerson = requestCtx();
  assert.notEqual(occurrenceRecordId(withPerson, 'ciclo', seed), id);
  const otherRequest = requestCtx();
  otherRequest.requestMeta = { requestId: 'other', source: 'test' };
  assert.equal(occurrenceRecordId(withPerson, 'ciclo', seed), occurrenceRecordId(otherRequest, 'ciclo', seed));
});

test('two creation contexts keep distinct first ids and leave the parent generator in place', () => {
  const parent = requestCtx();
  const issued: string[] = [];
  parent.idGenerator = {
    newId() {
      const id = `parent-${issued.length}`;
      issued.push(id);
      return id;
    },
  };
  const left = createOccurrenceContext(parent, 'wf_left');
  const right = createOccurrenceContext(parent, 'wf_right');
  assert.equal(left.idGenerator.newId(), 'wf_left');
  assert.equal(right.idGenerator.newId(), 'wf_right');
  assert.equal(left.idGenerator.newId(), 'parent-0');
  assert.equal(right.idGenerator.newId(), 'parent-1');
  assert.deepEqual(issued, ['parent-0', 'parent-1']);
  assert.equal(parent.idGenerator.newId(), 'parent-2');
  assert.equal(parent.idGenerator.newId(), 'parent-3');
  assert.notEqual(left.idGenerator, parent.idGenerator);
  assert.notEqual(left.mdm, parent.mdm);
  assert.equal(left.data, parent.data);
  assert.equal(left.cache, parent.cache);
  assert.equal(left.log, parent.log);
  assert.equal(left.clock, parent.clock);
  assert.equal(left.sessionContext, parent.sessionContext);
  assert.equal(left.moduleId, parent.moduleId);
  assert.equal(left.requestMeta, parent.requestMeta);
  assert.equal(left.organization, parent.organization);
  assert.equal(left.collabAuthInvite, parent.collabAuthInvite);
  assert.equal(left.sandbox, parent.sandbox);
});

test('a consumer error does not replace the parent generator', () => {
  const parent = requestCtx();
  const seen: string[] = [];
  parent.idGenerator = {
    newId() {
      const id = `kept-${seen.length}`;
      seen.push(id);
      return id;
    },
  };
  const generator = parent.idGenerator;
  const child = createOccurrenceContext(parent, 'wf_record');
  assert.throws(() => {
    const created = child.idGenerator.newId();
    assert.equal(created, 'wf_record');
    throw new Error('create failed before persistence');
  });
  assert.equal(parent.idGenerator, generator);
  assert.equal(parent.idGenerator.newId(), 'kept-0');
  assert.equal(child.idGenerator.newId(), 'kept-1');
  assert.notEqual(child.idGenerator.newId(), 'wf_record');
});

test('the child facade writes memory data and cache, and repository factories receive the child', async () => {
  clearRepositories();
  try {
    const parent = createRequestContext(createMemoryDataRuntime());
    parent.moduleId = 'tarefas';
    parent.sessionContext.project.projectId = '10';
    const recordId = 'wf_mdm_record';
    const child = createOccurrenceContext(parent, recordId);
    const index: MdmEntityIndexRecord = {
      mdmId: 'mdm-person',
      subtype: 'Person',
      name: 'Ada',
      status: 'Active',
      docType: null,
      docId: null,
      countryCode: 'BR',
      tags: [],
      searchVector: 'ada',
      mergedInto: null,
      dynamoPk: 'mdm-person',
      createdAt: '2026-10-17T00:00:00.000Z',
      updatedAt: '2026-10-17T00:00:00.000Z',
    };
    await child.data.mdmEntityIndex.insert({ record: index });
    const parentCalls: string[] = [];
    const parentGenerator = parent.idGenerator;
    parent.idGenerator = {
      newId() {
        const id = parentGenerator.newId();
        parentCalls.push(id);
        return id;
      },
    };
    const saved = await child.mdm.identity.setLogin('mdm-person', 'Ada@Example.com');
    assert.equal(saved.mdmId, 'mdm-person');
    const rows = await child.data.mdmTag.findMany({ where: { entityId: 'mdm-person' } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, recordId);
    assert.equal(rows[0]?.tag, 'ada@example.com');
    const cached = await child.cache.get<{ mdmId: string }>(identityCacheKey('ada@example.com'));
    assert.equal(cached?.mdmId, 'mdm-person');
    assert.equal(await child.mdm.identity.findByLogin('ada@example.com'), 'mdm-person');
    assert.ok(parentCalls.length > 0);
    assert.ok(parentCalls.every(id => id !== recordId));
    assert.notEqual(child.mdm, parent.mdm);

    const port = 'OccurrenceContextProbe';
    registerRepository(port, (received) => received);
    assert.equal(resolveRepository(child, port), child);
    assert.notEqual(resolveRepository(parent, port), child);
  } finally {
    clearRepositories();
  }
});
