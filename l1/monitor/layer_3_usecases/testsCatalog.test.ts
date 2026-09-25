/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsCatalog.test.ts" enhancement="_blank" />
// Backend catalog verdicts go through the producer's classifyCase. A structure stub
// (caseId + USECASE_NOT_IMPLEMENTED + 501) is expectedRed. Any other code, status,
// or a compile/import/transport break is failed — never expected-red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { M1_STUB_ERROR, M1_STUB_STATUS, type M1ScenarioCase } from '/_102021_/l2/agentMaterializeL1/testing/catalog.js';
import { emptyRunCoverage, evaluate, observationFromExec, verdictForCatalogCase } from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';

const item: M1ScenarioCase = {
  caseId: 'createConsulta.creates',
  gate: 'business',
  mandatory: true,
  source: 'rt28',
  expectation: 'creates a consult',
  preconditions: ['note omitted'],
  synthetic: [],
  actorId: 'professional',
  routine: 'consult.cmd.createConsulta',
  mutating: true,
  expect: {
    ok: true,
    status: 201,
    errorCode: null,
    ruleId: null,
    forbiddenFields: [],
    isolatedActorField: null,
  },
  expectedFailure: {
    caseId: 'createConsulta.creates',
    stage: 'structure',
    errorCode: M1_STUB_ERROR,
    status: M1_STUB_STATUS,
  },
};

test('structure stub with the catalog caseId is expectedRed', () => {
  const observation = observationFromExec(item.caseId, 4, {
    statusCode: M1_STUB_STATUS,
    response: { ok: false, data: null, error: { code: M1_STUB_ERROR, message: 'stub' } },
  });
  const verdict = verdictForCatalogCase('structure', item, observation);
  assert.equal(verdict.verdict, 'expectedRed');
});

test('the same case with a different error or a broken transport is failed', () => {
  const other = observationFromExec(item.caseId, 4, {
    statusCode: 500,
    response: { ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'boom' } },
  });
  assert.equal(verdictForCatalogCase('structure', item, other).verdict, 'failed');

  const wrongStatus = observationFromExec(item.caseId, 4, {
    statusCode: 500,
    response: { ok: false, data: null, error: { code: M1_STUB_ERROR, message: 'stub' } },
  });
  assert.equal(verdictForCatalogCase('structure', item, wrongStatus).verdict, 'failed');

  const transport = observationFromExec(item.caseId, 1, null, { broken: 'transport' });
  transport.errorCode = M1_STUB_ERROR;
  transport.status = M1_STUB_STATUS;
  const broken = verdictForCatalogCase('structure', item, transport);
  assert.equal(broken.verdict, 'failed');
  assert.match(broken.detail, /transport broken/);
});

test('no registered suite is untested, not an empty pass', () => {
  const coverage = emptyRunCoverage(0);
  assert.equal(coverage.untested, true);
  assert.match(coverage.untestedReason, /não testado/);
  assert.equal(emptyRunCoverage(1).untested, false);
});

test('frontend expectedFail text mark still becomes knownFail and does not use expectedRed', () => {
  const result = evaluate(
    {
      id: 'page.case',
      routine: 'mod.qry.list',
      params: {},
      expect: { ok: true },
      mutating: false,
      expectedFail: 'mdm-rebuild',
    },
    'mod',
    'page',
    { response: { ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'no' } }, statusCode: 500 },
    1,
    [],
  );
  assert.equal(result.status, 'knownFail');
});
