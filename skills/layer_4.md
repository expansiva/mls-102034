# layer_4.md — generate layer_4_entities/{Entity}.ts from entity .defs.ts

**Goal:** transform each `l1/{module}/layer_4_entities/{entityId}.defs.ts` (plus the table defs it
references) into ONE TypeScript file containing the entity **contract (interface) and
implementation together**, so layer_3 imports both from the same place. Layer_4 is the ONLY layer
allowed to use `ctx.data.*` — this is the layer that knows HOW to operate a table.

This generation is intentionally **mechanical**: everything needed is in the defs. Do not invent
operations or business rules — rules live in layer_3.

## Inputs

1. The entity defs — **self-sufficient for most entities**: `{ entityId, title, purpose,
   layer: 'layer_4_entities', fields[] / statusEnum[] / lifecycleStates[] (canonical domain
   shape — NOT in l5/module.defs.ts, which keeps only the domain map), sourceTables[],
   storage[] ({ kind: 'moduleTable'|'metricTable', tableId/metricTableId, tableName, fileRef }
   or { kind: 'mdm', moduleRef: '102034', entity, fileRef }), allowedOperations[], usecaseRefs[],
   metricShape? ({timeColumn, dimensions, measures} for metric entities),
   materialization: { fileName, className, contractName } }`.
2. The table defs referenced by `storage[].fileRef` — needed only for the PHYSICAL form
   (snake_case columns, primaryKey, detailsColumn, indexes) and for multi-table groups whose
   defs omit `fields`.

## Output file skeleton

`l1/{module}/layer_4_entities/{className}.ts` (className/contractName come from
`materialization`):

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_4_entities/DealEntity.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

// 1. Record types — derived from the table defs columns (snake_case fields, exact types).
export type DealStatus = 'open' | 'won' | 'lost';                  // from status/lifecycle enums
export interface DealRecord { deal_id: string; lead_id: string; /* ... every column */ details?: string | null; }
export interface DealDetails { /* fields stored inside the JSONB details column */ }

// 2. Contract — one method per allowedOperation (+ derived finders). Layer_3 imports this.
export interface IDealEntity {
  create(ctx: RequestContext, input: CreateDealInput, runtime?: IDataRuntime): Promise<DealRecord>;
  getById(ctx: RequestContext, dealId: string, runtime?: IDataRuntime): Promise<DealRecord>;
  list(ctx: RequestContext, filter?: ListDealFilter, runtime?: IDataRuntime): Promise<DealRecord[]>;
  advanceStage(ctx: RequestContext, input: AdvanceStageInput, runtime?: IDataRuntime): Promise<DealRecord>;
  parseDetails(record: DealRecord): DealDetails;
}

// 3. Implementation — the ONLY place that touches ctx.data / repositories.
export const DealEntity: IDealEntity = { /* ... */ };
```

## Method generation rules

- One method per `allowedOperations` entry. Standard verbs: `create`, `read` → `getById`,
  `update`, `delete`, `list`; domain verbs (`advanceStage`, `closeWon`, `changeStatus`, ...) become
  semantic methods that encapsulate the column/status writes they imply.
- **Every method takes `(ctx: RequestContext, ..., runtime?: IDataRuntime)`** and resolves the
  data source as `const data = runtime ?? ctx.data;` — this is how layer_3 transactions reach the
  entity (`ctx.data.runInTransaction(tx => DealEntity.create(ctx, input, tx))`).
- Table access: `const repo = await data.moduleData.getTable<DealRecord>('deal');` then ONLY the
  `ITableRepository` operations (`findOne/findMany/findManyByValues/insert/upsert/update/delete`).
  `orderBy` is ALWAYS `{ field: 'created_at', direction: 'desc' }` — never `{created_at:'desc'}`.
- `getById` throws `AppError('NOT_FOUND', ..., 404, { id })` when missing.
- Ids: `ctx.idGenerator`; timestamps: `ctx.clock`.

## details (JSONB) handling

When the table defs has `detailsColumn.enabled: true`:
- Declare the `{Entity}Details` interface; provide `parseDetails(record)` (safe JSON.parse with
  `{}` fallback) and merge-on-write (`details: JSON.stringify({ ...parseDetails(current), ...patch })`).
- Promote NOTHING from details into queries — fields needed for filtering are real columns by
  design; if a filter on a details field is requested, that is a planning error, not a workaround.

## Metric entities

For sourceTables that are metric tables, generate a `record{Event}` style method per measure
group: build the row with `timeColumn = ctx.clock` value, every dimension as a column, measures as
numbers, and `insert` it. Metric tables are append-only: never `update`/`delete`.

## MDM-backed entities

When a sourceTable ownership is `mdmOwned` (table defs is an `mdmEntity` with
`infrastructureModuleRef: '102034'`):
- There is NO module table. Resolve through the shared MDM runtime:
  `data.mdmEntityIndex.findOne({ where: { mdmId } })`, `data.mdmDocument.get({ mdmId })` /
  `getMany({ mdmIds })`; the entity fields come from the document `details` (use the defs
  `fields[]` to type the result).
- Expose the same contract style (`getById`, `list`, finders) so layer_3 cannot tell MDM from
  local tables. Writes to master data go through the MDM usecases of 102034 — do not write
  `mdm_*` tables directly from a client module.

## Checks before finishing

1. `ctx.data` / `data.` usage only inside this file's implementation object.
2. Contract interface and implementation exported from the SAME file; record types exported.
3. Every `allowedOperations` entry has a method; no method without a defs origin.
4. No business validation beyond shape/NOT_FOUND — cross-entity rules belong to layer_3.
