# Backend architecture — layer contract (client modules)

Reference for any LLM/agent that materializes client-module backend code from `.defs.ts` planning
artifacts. Per-layer generation guidelines: `layer_1.md`, `layer_2.md`, `layer_3.md`, `layer_4.md`.
Diagram: `docs/l1_en.svg` (pt-BR: `docs/l1_br.svg`).

## The four layers

A request flows **2 → 3 → 4 → 1** (the folder numbering is NOT the call order):

| Layer | Folder | Responsibility | Forbidden |
|---|---|---|---|
| layer_2 | `l1/{module}/layer_2_controllers` | BFF: receives page requests, validates input, calls usecases, shapes the response | touching tables or entities; business rules |
| layer_3 | `l1/{module}/layer_3_usecases` | decides WHAT happens: business rules, validations, state transitions, orchestration across entities, transactions | `ctx.data.*`; knowing columns/JSONB shapes |
| layer_4 | `l1/{module}/layer_4_entities` | knows HOW to operate one entity: query normalization, column vs `details` (JSONB), MDM resolution, metric writes, semantic operations | business rules that span entities |
| layer_1 | `l1/{module}/layer_1_external` | WHERE data persists: table definitions consumed by the platform registry (Postgres / Dynamo / Memory / TimescaleDB) — **module-owned physical storage ONLY** | application logic; artifacts for data the module does not own (MDM references) |

## Hard rules (mechanically verifiable)

1. **`ctx.data.*` appears ONLY inside `layer_4_entities/*.ts`.** Validators enforce this with a
   grep — any other occurrence is a generation error.
2. **layer_2 imports only from layer_3** (functions + their input/output types). Phase 2 will allow
   a documented exception (trivial read with zero rules calling layer_4 directly) — it is DISABLED
   until the planning contracts declare it explicitly.
3. **layer_3 imports entity contracts only from layer_4** (`import { DealEntity, type IDealEntity,
   type DealRecord } from '../layer_4_entities/DealEntity.js'`). Never redeclare record types.
4. **The layer_4 entity defs is the single source of truth for the domain shape.** It carries the
   COMPLETE `fields[]` list (camelCase, semantic types, one abstraction level) for every entity —
   MDM-backed or table-backed. Record types live in layer_4, derived from those fields; layer_3
   and layer_2 must import them, never duplicate them.
5. **MDM master data** (storage entry `{ kind: 'mdm', moduleRef: '102034', entity }`) is never a
   local table and has **NO artifact in layer_1**: the shape and the MDM governance metadata
   (`domainId`, `governanceRules`, `sourceOfTruth`) live in the layer_4 entity defs storage block;
   layer_4 resolves reads/writes through the shared MDM runtime; layers 2/3 cannot tell the
   difference. (Legacy runs may still contain `mdmEntity` ref files in layer_1 — ignore them.)
6. **Derivation direction is layer_4 → layer_1, deterministic.** For entities with module-owned
   tables, the physical defs (snake_case columns, db types) is DERIVED from the entity defs
   (`fieldId` → column) by template — never edited independently. Every entity field maps to a
   storage column and every column maps back (validators check both directions).
7. **Transactions** are STARTED in layer_3 and EXECUTED by layer_4:
   ```ts
   await ctx.data.runInTransaction(async (tx) => {
     await DealEntity.advanceStage(ctx, input, tx);
     await DealMetricsEntity.record(ctx, event, tx);
   });
   ```
   Every layer_4 method accepts an optional trailing `runtime?: IDataRuntime` (default `ctx.data`).
   Exception to rule 1: this single `ctx.data.runInTransaction(...)` call is allowed in layer_3 —
   the callback must only pass `tx` to entity methods, never use it directly.

## Shared platform contracts (project 102034)

```ts
import { ok, AppError, type BffHandler, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
// RequestContext: { data: IDataRuntime; log; clock; idGenerator; requestMeta? }
// IDataRuntime:   { moduleData: IModuleDataRuntime; mdmDocument; mdmEntityIndex; ...; runInTransaction(cb) }
// IModuleDataRuntime.getTable<TRecord>(name): Promise<ITableRepository<TRecord>>
```

`ITableRepository<TRecord>` operations (the ONLY low-level API, used inside layer_4):
`findOne({where})`, `findMany({where?, orderBy?: {field, direction}, limit?})`,
`findManyByValues({field, values, limit?})`, `insert({record})`, `upsert({record})`,
`update({where, patch})`, `delete({where})`.

## Generation conventions (all layers)

- First line of every generated file: `/// <mls fileReference="<outputFileReference>" enhancement="_blank" />`
- Imports use the platform path style: `/_{project}_/l1/.../file.js` (always `.js`).
- `AppError(code, message, httpStatus, details?)` with codes `VALIDATION_ERROR` (400),
  `NOT_FOUND` (404), `CONFLICT` (409).
- Generate only what the `.defs.ts` declares. Do not invent operations, columns or rules.
- ids: camelCase; entity class/file names: PascalCase; physical table/column names: snake_case.
