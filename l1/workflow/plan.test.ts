/// <mls fileReference="_102034_/l1/workflow/plan.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ILogger } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { OccurrenceKey, WorkflowTable } from '/_102034_/l1/workflow/contracts.js';
import { createWorkflowEngine, type WorkflowEngineContext } from '/_102034_/l1/workflow/engine.js';
import { createMemoryOccurrencePort } from '/_102034_/l1/workflow/memoryOccurrence.js';
import {
  indexWorkflowTable,
  prepareWorkflowPlan,
  type WorkflowPlan,
  type WorkflowPlanInput,
  type WorkflowPlanStepInput,
} from '/_102034_/l1/workflow/plan.js';

function step(overrides: Partial<WorkflowPlanStepInput> & Pick<WorkflowPlanStepInput, 'stepId' | 'kind' | 'title' | 'next'>): WorkflowPlanStepInput {
  return { ...overrides };
}

function planInput(): WorkflowPlanInput {
  return {
    processId: 'ciclo',
    title: 'Ciclo da tarefa',
    moduleTitle: 'Tarefas',
    steps: [
      step({
        stepId: 'h',
        kind: 'human',
        title: 'Pessoa',
        actorRef: 'ada',
        conditions: 'when the note says: keep "quotes" and\nline two',
        params: { note: 'keep me exactly' },
        next: ['m'],
      }),
      step({
        stepId: 'm',
        kind: 'mechanical',
        title: 'Módulo',
        functionRef: 'fn.doWork',
        next: ['l'],
      }),
      step({
        stepId: 'l',
        kind: 'llm',
        title: 'Agente',
        journeyRef: 'journey.review',
        next: ['w'],
      }),
      step({
        stepId: 'w',
        kind: 'wait',
        title: 'Relógio',
        next: ['a'],
      }),
      step({
        stepId: 'a',
        kind: 'alert',
        title: 'Alerta',
        actorRef: 'bee',
        next: ['h'],
      }),
    ],
  };
}

interface ForcedStep {
  stepId: string;
  kind: string;
  title: string;
  next: readonly unknown[];
  actorRef?: unknown;
  journeyRef?: unknown;
  functionRef?: unknown;
  conditions?: unknown;
  params?: unknown;
}

function force(input: {
  processId: string;
  title: string;
  moduleTitle: string;
  steps: readonly ForcedStep[];
}): WorkflowPlanInput {
  return input as unknown as WorkflowPlanInput;
}

function rejectsTable(input: WorkflowPlanInput): void {
  assert.throws(
    () => prepareWorkflowPlan(input),
    (error: unknown) => error instanceof AppError
      && error.code === 'INVALID_WORKFLOW_TABLE'
      && error.statusCode === 400,
  );
}

test('prepareWorkflowPlan copies every kind, reference, condition and param', () => {
  const input = planInput();
  const plan = prepareWorkflowPlan(input);
  assert.equal(plan.processId, 'ciclo');
  assert.equal(plan.title, 'Ciclo da tarefa');
  assert.equal(plan.moduleTitle, 'Tarefas');
  assert.deepEqual(plan.steps.map((item) => item.stepId), ['h', 'm', 'l', 'w', 'a']);
  assert.deepEqual(plan.steps.map((item) => item.ownerKind), ['person', 'module', 'agent', 'clock', 'person']);
  assert.equal(plan.steps[0]?.actorRef, 'ada');
  assert.equal(plan.steps[0]?.conditions, 'when the note says: keep "quotes" and\nline two');
  assert.deepEqual(plan.steps[0]?.params, { note: 'keep me exactly' });
  assert.equal(plan.steps[1]?.functionRef, 'fn.doWork');
  assert.equal(plan.steps[2]?.journeyRef, 'journey.review');
  assert.deepEqual(plan.steps[4]?.next, ['h']);
  assert.equal(plan.steps[0]?.ownerKind, 'person');
  assert.notEqual(plan, input);
  assert.notEqual(plan.steps, input.steps);
  assert.notEqual(plan.steps[0], input.steps[0]);
  assert.notEqual(plan.steps[0]?.next, input.steps[0]?.next);
  assert.notEqual(plan.steps[0]?.params, input.steps[0]?.params);
});

test('a later edit of the input or of another preparation leaves the first plan intact', () => {
  const input = planInput();
  const first = prepareWorkflowPlan(input);
  const before = structuredClone(first) as WorkflowPlan;
  input.title = 'outro título';
  input.moduleTitle = 'Outro módulo';
  input.steps[0]!.title = 'mudou';
  input.steps[0]!.conditions = 'prosa nova';
  input.steps[0]!.params!.note = 'mudou';
  input.steps[0]!.next.push('w');
  input.steps.push(step({ stepId: 'x', kind: 'wait', title: 'Extra', next: [] }));
  assert.deepEqual(first, before);

  const edited = planInput();
  edited.title = 'Segundo';
  edited.steps[3]!.title = 'Espera nova';
  edited.steps[3]!.next = ['h'];
  const second = prepareWorkflowPlan(edited);
  assert.deepEqual(first, before);
  assert.equal(second.title, 'Segundo');
  assert.equal(second.steps[3]?.title, 'Espera nova');
  assert.notEqual(second.steps, first.steps);
});

test('prepareWorkflowPlan rejects a malformed plan', () => {
  const base = planInput();
  const cases: WorkflowPlanInput[] = [
    force({ ...base, steps: [base.steps[0]!, { ...base.steps[1]!, stepId: 'h' }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, next: ['missing'] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, stepId: 'end', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, next: ['end'] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, stepId: '', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, stepId: ' h', next: [] }] }),
    force({ ...base, processId: ' ciclo' }),
    force({ ...base, steps: [{ ...base.steps[0]!, kind: 'nope', next: [] }] }),
    force({ ...base, steps: [] }),
    force({ ...base, title: '' }),
    force({ ...base, title: '   ' }),
    force({ ...base, moduleTitle: '' }),
    force({ ...base, steps: [{ ...base.steps[0]!, title: '', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, next: 'h' as unknown as string[] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, next: [''] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, next: [' m'] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, functionRef: ' fn', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, actorRef: '', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, journeyRef: ' ', next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, conditions: 1, next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, params: ['keep'], next: [] }] }),
    force({ ...base, steps: [{ ...base.steps[0]!, params: { note: 1 }, next: [] }] }),
  ];
  for (const candidate of cases) rejectsTable(candidate);
});

test('a minimal table without titles still indexes and opens, and prepare refuses it', async () => {
  const minimal: WorkflowTable = {
    processId: 'ciclo',
    steps: [{ stepId: 'S', kind: 'human', next: [] }],
  };
  const indexed = indexWorkflowTable(minimal, 'ciclo');
  assert.equal(indexed.get('S')?.stepId, 'S');
  rejectsTable(minimal as unknown as WorkflowPlanInput);

  const lines: { message: string }[] = [];
  const log: ILogger = {
    info(message) { lines.push({ message }); },
    error(message) { lines.push({ message }); },
  };
  const caller: WorkflowEngineContext = {
    clock: { nowIso: () => '2026-10-19T12:00:00.000Z' },
    log,
  };
  const occurrence: OccurrenceKey = {
    project: '10',
    module: 'tarefas',
    processId: 'ciclo',
    entity: 'Tarefa',
    recordId: 'r1',
  };
  const opened = await createWorkflowEngine(createMemoryOccurrencePort()).open(caller, minimal, occurrence, 'S', null);
  assert.equal(opened.outcome, 'created');
  assert.equal(opened.occurrence.step, 'S');
});
