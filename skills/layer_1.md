# layer_1.md — generate layer_1_external persistence files from .defs.ts

**Goal:** transform each table-like `.defs.ts` into the `TableDefinition` object the platform
registry consumes. Layer_1 is configuration, not logic — WHERE data persists
(Postgres / TimescaleDB / Dynamo / Memory are swappable behind the registry).

## Inputs

One of two artifact kinds found in `l1/{module}/layer_1_external/*.defs.ts` — layer_1 contains
ONLY storage the module physically owns:

1. **Transactional table** — `data.tableDefinition` with `tableKind: 'transactional'`,
   `generateTable` implicit true, `columns[]`, `primaryKey`, `foreignRefs[]`, `indexes[]`,
   optional `detailsColumn` (JSONB) and `metricUpdatePolicy`.
2. **Metric table** — `data.metricTableDefinition` with `tableKind: 'metricTimeseries'`,
   `storageEngine: 'postgresTimescaleDB'`, `timeColumn`, `dimensions[]`, `measures[]`, `hypertable`.

These defs are DERIVED from the layer_4 entity defs (`fieldId` camelCase → column snake_case);
the entity defs is the canonical shape — when in doubt about a field, the answer is in layer_4,
not here.

## Output

For kinds 1 and 2: `l1/{module}/layer_1_external/{tableId}.ts` exporting
`export const {tableId}TableDef: TableDefinition = {...}` with:

```ts
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
```

## Mapping rules (defs → TableDefinition)

- `tableName`, `moduleId` → copy as-is; `description` ← title/purpose text from the defs.
- `tableKind: 'transactional'` → `purpose: 'transacao'`, `storageProfile: 'postgres'`,
  `writeMode: 'sync'`, `backupHot: false`.
- `tableKind: 'metricTimeseries'` → `purpose: 'controle'`, `storageProfile: 'postgres'`,
  `writeMode: 'sync'`, `backupHot: false`, plus
  `timescale: { hypertable: { timeColumn, chunkTimeInterval } }` from the defs hypertable block.
- Column types: uuid→UUID, text→TEXT, int/integer→INTEGER, decimal/numeric→NUMERIC,
  timestamptz→TIMESTAMPTZ, date→DATE, time→TIME, boolean→BOOLEAN, jsonb→JSONB.
- `nullable` from the defs column; `defaultSql` when the defs declares a default
  (timestamps → `"NOW()"`).
- `detailsColumn.enabled: true` → ensure a `details JSONB` nullable column exists.
- `repositoryName`: `moduleId + PascalCase(tableName)` (e.g. `propertyFlowCrm` + `deal` →
  `propertyFlowCrmDeal`).
- `indexes` from the defs indexes (name, columns, unique).
- `version: 1` for new files; bump only on schema change.

## MDM master data — NO layer_1 artifact

- MDM-backed entities (storage `{ kind: 'mdm', moduleRef: '102034', entity }` in the layer_4
  entity defs) have **no file in layer_1_external**: the shape (`fields[]`) and the governance
  metadata (`domainId`, `governanceRules`, `sourceOfTruth`) live in the layer_4 entity defs.
  The live data is owned by the shared MDM infrastructure (project 102034: `mdm_documents`,
  `mdm_documents_entities_index`, ...).
- If a usecase/entity needs that data, the access is generated in **layer_4** (see `layer_4.md`,
  "MDM-backed entities") — not here.
- Legacy runs may still contain `artifactType: 'mdmEntity'` / `generateTable: false` ref files in
  this folder: never emit a `TableDefinition` for them; treat the layer_4 entity defs as the
  authoritative shape.

## Checks before finishing

1. Every defs with `generateTable !== false` produced exactly one `TableDefinition` export.
2. No `TableDefinition` produced for MDM master data (including legacy mdmEntity refs).
3. `primaryKey` non-empty; metric tables include the `timescale` block and the `timeColumn`
   exists in `columns`.
4. Physical names snake_case; `repositoryName` camelCase.
5. Every column traces back to a field in the owning layer_4 entity defs (derivation L4 → L1);
   a column with no corresponding entity field is a planning error — report it, do not invent
   a field.
