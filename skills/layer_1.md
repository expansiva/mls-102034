# layer_1.md — generate layer_1_external persistence files from .defs.ts

**Goal:** transform each table-like `.defs.ts` into the `TableDefinition` object the platform
registry consumes. Layer_1 is configuration, not logic — WHERE data persists
(Postgres / TimescaleDB / Dynamo / Memory are swappable behind the registry).

## Inputs

One of three artifact kinds found in `l1/{module}/layer_1_external/*.defs.ts`:

1. **Transactional table** — `data.tableDefinition` with `tableKind: 'transactional'`,
   `generateTable` implicit true, `columns[]`, `primaryKey`, `foreignRefs[]`, `indexes[]`,
   optional `detailsColumn` (JSONB) and `metricUpdatePolicy`.
2. **Metric table** — `data.metricTableDefinition` with `tableKind: 'metricTimeseries'`,
   `storageEngine: 'postgresTimescaleDB'`, `timeColumn`, `dimensions[]`, `measures[]`, `hypertable`.
3. **MDM entity reference** — `artifactType: 'mdmEntity'`, `generateTable: false`,
   `infrastructureModuleRef: '102034'`, `fields[]`. **Generates NO physical table** — see rules.

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

## MDM entity references (kind 3) — DO NOT create a table

- Never emit a `TableDefinition` for `artifactType: 'mdmEntity'` / `generateTable: false`.
- The defs exists so layer_4 can derive the record type (`fields[]`) and so mocks/tests know the
  shape. The live data is owned by the shared MDM infrastructure (project 102034:
  `mdm_documents`, `mdm_documents_entities_index`, ...).
- If a usecase/entity needs that data, the access is generated in **layer_4** (see `layer_4.md`,
  "MDM-backed entities") — not here.

## Checks before finishing

1. Every defs with `generateTable !== false` produced exactly one `TableDefinition` export.
2. No `TableDefinition` produced for mdmEntity refs.
3. `primaryKey` non-empty; metric tables include the `timescale` block and the `timeColumn`
   exists in `columns`.
4. Physical names snake_case; `repositoryName` camelCase.
