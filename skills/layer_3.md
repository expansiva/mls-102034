# layer_3.md — generate layer_3_usecases/{usecaseId}.ts from usecase .defs.ts

**Goal:** transform each `l1/{module}/layer_3_usecases/{usecaseId}.defs.ts` into a usecase
implementation. Layer_3 decides WHAT happens — business rules, validations, state transitions and
orchestration across entities — and knows NOTHING about columns, JSONB shapes or repositories.

## Inputs

1. The usecase defs (bare `useCase` export): `{ usecaseId, title, purpose, actor,
   layer: 'layer_3_usecases', inputEntities[], outputEntities[], readsTables[], writesTables[]
   ({tableName, ownership}), commands[] ({commandId, input[], output[]}), rulesApplied[],
   entityRefs[] }`.
2. For each `entityRefs` entry: the layer_4 entity defs/file — the usecase consumes its CONTRACT
   (`I{Entity}`) and record types.
3. The module rules (`l5/{module}/rules.defs.ts`) for the `rulesApplied` ids.

## Output file skeleton

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_3_usecases/advanceDealStage.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { DealEntity, type DealRecord } from '/_{project}_/l1/{module}/layer_4_entities/DealEntity.js';
import { DealMetricsEntity } from '/_{project}_/l1/{module}/layer_4_entities/DealMetricsEntity.js';

export interface AdvanceDealStageInput { dealId: string; targetStage: string; }
export interface AdvanceDealStageResult { deal: DealRecord; }

export async function advanceDealStage(ctx: RequestContext, input: AdvanceDealStageInput): Promise<AdvanceDealStageResult> {
  // 1. validations (business rules from rulesApplied)
  // 2. load state via entities, decide the transition
  // 3. write via entities — in a transaction when more than one entity is written
  const deal = await ctx.data.runInTransaction(async (tx) => {
    const updated = await DealEntity.advanceStage(ctx, input, tx);
    await DealMetricsEntity.recordStageTransition(ctx, { dealId: updated.deal_id, stage: input.targetStage }, tx);
    return updated;
  });
  return { deal };
}
```

## Rules

- **One exported async function per `commands[]` entry**, signature
  `(ctx: RequestContext, input: {CommandId}Input) => Promise<{CommandId}Output>`. Input/output
  interfaces come from the command's typed `input[]`/`output[]` fields — export them (layer_2
  imports these types; never let layer_2 redeclare them).
- **Data access ONLY through the entities in `entityRefs`** — import contract + instance from
  `../layer_4_entities/{Entity}.js`. `ctx.data.*` is FORBIDDEN here, with one exception:
  the `ctx.data.runInTransaction(async (tx) => { ... })` wrapper, whose callback may only pass
  `tx` to entity methods.
- Record/domain types are imported from layer_4, never redeclared.
- A usecase that writes more than one table (e.g. base table + metric table — check
  `writesTables`) MUST wrap the writes in a single transaction.
- Business validations throw `AppError('VALIDATION_ERROR' | 'CONFLICT', message, 400 | 409,
  details)`; reference the `rulesApplied` rule id in the message or details when applicable.
- Lifecycle/state transitions: validate the source state before writing the target state
  (read via entity, compare, then write) — never blind-update.
- Metric writes accompany the business event in the same transaction (per
  `metricUpdatePolicy.updatedByLayer: 'layer_3_usecases'`).
- Do not invent extra reads/writes: `readsTables`/`writesTables` is the authoritative surface.
  If a table has no owning entity in `entityRefs`, STOP and report the gap (planning error)
  instead of falling back to `ctx.data`.

## Implementation echo (for layer_2)

After generating, record in the usecase defs an `implementation` block so the controller
generator can import without guessing:
`{ functionName, inputTypeName, outputTypeName, tsFileRef }` per command.

## Checks before finishing

1. `grep ctx.data` matches only `runInTransaction` wrappers.
2. Every import from layer_4 corresponds to an `entityRefs` entry.
3. Every command has its function + exported input/output types.
4. Multi-table writes are inside one transaction.
