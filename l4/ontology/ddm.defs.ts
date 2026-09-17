/// <mls fileReference="_102034_/l4/ontology/ddm.defs.ts" enhancement="_blank"/>
/**
 * The catalog a DERIVED table of a module starts from — the metric, the summary, the aggregate, the
 * series (ns5_46).
 *
 * A `ddm` entity exists because something has to be read fast that is expensive to recompute on every
 * screen. Nobody writes it: every field is `derived`, there is no lifecycle and no transition, and there
 * is no unique key per row — the window plus the group already identify it, and the recalculation
 * rewrites it whole. A value that a person types, or that follows from one row of a `tdm` table, is not
 * a `ddm` entity: the first is `tdm`, the second is a field of that row marked `derived`.
 *
 * The living example in the platform is the monitor: `monitor_bff_execution_log` is the `tdm` side (a
 * hypertable of events) and `monitor_bff_execution_agg_minute` is the `ddm` side, a Timescale continuous
 * aggregate over `time_bucket('1 minute', …)` with a refresh policy and a retention policy
 * (`l1/monitor/persistence.ts:81-117`). Everything this file calls `partial` or `missing` is measured
 * against that same machinery.
 *
 * Everything below the `export const` is ONE JSON literal, double-quoted, with no comments inside it, so
 * that the same extractor the screens and the agents use (`extractNs4ClassicJsonObject` + `JSON.parse`)
 * reads it whole. It is checked by `l1/mdm/defs/dataFamilyOntology.test.ts`, which imports this file.
 */

import type { DataFamilyOntology } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const ddm = {
  "schemaVersion": "2026-09-17-ddm-ontology-v1",
  "family": "ddm",
  "title": "Derived data of a module",
  "description": "What is recalculated from transactional and master data: a metric, a summary, an aggregate, a series in time. It has no writer, no state and no business key of its own.",

  "record": {
    "fields": {
      "<window>": { "type": "timestamp", "required": true, "derived": true, "indexed": true, "description": "The start of the window this row summarises — the time column of the series (the `time_bucket` of the aggregate). Present whenever the summary is over time." },
      "<groupKey>": { "type": "string", "derived": true, "indexed": true, "description": "One key per dimension the summary is grouped by: the id of a master record, the id of a row of a tdm table, or a code. Indexed, because every read filters by it." },
      "details": {
        "type": "object",
        "required": true,
        "description": "The JSONB document, and where every measure lives. A column exists because something filters, sorts or deduplicates by it; a summary is filtered by its window and its groups, never by its numbers, so a measure is never a column.",
        "fields": {
          "<measure>": { "type": "number", "required": true, "derived": true, "description": "One key per number: a count, a sum, an average, a maximum. Always derived — nobody ever writes one." }
        }
      }
    }
  },

  "recommendations": [
    "Nobody writes a `ddm` row: every field is `derived`. If a person can type it, the entity is `tdm`.",
    "No lifecycle and no transition: a summary does not change state, it is recalculated.",
    "No unique key per row: the window plus the group keys already identify the row, and the recalculation rewrites it.",
    "Name the source: a `ddm` entity summarises rows of a named `tdm` table (or of the master records), and its description says which one and over which window.",
    "The window and the group keys are the columns, and every one of them is indexed. Every measure lives inside `details`: nothing filters by a number, and a column with no index is refused.",
    "`storage.kind: 'timeSeries'` when the rows are a series in time and are stored as a hypertable; `relational` for a plain rollup table refreshed as a whole.",
    "A value that follows from ONE row of a `tdm` table — a status implied by its own dates, the total of its own embedded lines — is not a `ddm` entity: it is a field of that row marked `derived`."
  ],

  "capabilities": {
    "aggregate.byWindow": { "source": "table", "sentence": "Summarises the rows of a transactional table by time window and by group · a Timescale continuous aggregate (time_bucket + GROUP BY) declared as a statement of viewDefinitions in the persistence of the module and applied after the tables are created · every dashboard and every counter by period · it runs only where the timescaledb extension is available: the bootstrap warns and skips the statement otherwise, and the in-memory runtime of the preview has none of it", "platform": "partial", "evidence": "l1/monitor/persistence.ts:91-117 (the living example); l1/server/layer_1_external/persistence/schemaBootstrap.ts:342-358 (applyViewDefinitions), :340 (the skip pattern), :158-172 (the extension check); registry.ts:511-524 (viewDefinitions are read from the module persistence)" },
    "store.timeSeries": { "source": "table", "sentence": "Keeps the rows as a series chunked by time, so a window is read without touching the whole table · timescale.hypertable of the TableDefinition, turned into create_hypertable(table, timeColumn, chunk_time_interval) · a series read by period · non-fatal: when the extension is missing the table stays an ordinary one and only a warning is written", "platform": "partial", "evidence": "persistence/contracts.ts:50-55 (declaration); schemaBootstrap.ts:281-297 (create_hypertable, the failure kept non-fatal); l1/monitor/persistence.ts:81-87 (the living example)" },
    "read.window": { "source": "table", "sentence": "Reads the summary for a period and a group · findMany({ where, orderBy, limit, offset }) over the window column and the group keys, both indexed · the screen that shows the metric", "platform": "ready", "evidence": "l1/server/layer_1_external/data/moduleDataRuntime.ts:78, :19-30" },
    "refresh": { "source": "table", "sentence": "Keeps the summary up to date as the source rows arrive · add_continuous_aggregate_policy, declared as one more statement of the same view definition (start_offset, end_offset, schedule_interval) · the platform, on its own · Timescale only, and nothing outside the platform's own monitor has ever declared one", "platform": "partial", "evidence": "l1/monitor/persistence.ts:111-114; schemaBootstrap.ts:342-358 (the statement is executed at bootstrap, never after)" },
    "rebuild": { "source": "table", "sentence": "Recomputes the whole summary from the source rows · the schema rebuild drops the continuous aggregates and the views it owns and recreates them from the declaration · a migration or a publish · there is no routine a module can call to rebuild one series on demand", "platform": "partial", "evidence": "schemaBootstrap.ts:204-230 (the owned views and aggregates are dropped), :342-358 (recreated); no refresh entry point in layer_2_controllers" },
    "resample": { "source": "table", "sentence": "Reads the same series at another granularity, minute to hour to day · a second aggregate declared the same way, over the first one · a screen that zooms out · there is no granularity parameter at read time: each granularity is a table of its own", "platform": "partial", "evidence": "moduleDataRuntime.ts:19-30 offers where, ilike, orderBy, limit and offset, and no bucket; the only mechanism is the one of aggregate.byWindow (l1/monitor/persistence.ts:94-110), declared a second time at the other granularity" },
    "retain": { "source": "table", "sentence": "Drops the rows older than the period that matters, so the series does not grow forever · add_retention_policy as a statement of the view definition · the platform, on its own · the retentionDays field of the TableDefinition is declared and read by NOBODY, so the declarative path does not exist; only the raw statement works, and only with Timescale", "platform": "partial", "evidence": "l1/monitor/persistence.ts:115 (the living example); persistence/contracts.ts:83 (retentionDays, with no reader anywhere in mls-102034)" },
    "backfill": { "source": "table", "sentence": "Fills the summary for a period that is already past · the continuous aggregate is created WITH NO DATA and filled by its policy from start_offset onwards; a period older than that window is never computed · whoever turns the metric on after the fact", "platform": "missing", "evidence": "l1/monitor/persistence.ts:110 (WITH NO DATA), :112 (start_offset '3 minutes'); no backfill or refresh_continuous_aggregate call anywhere in mls-102034" },
    "read.mdmRecord": { "source": "platform", "sentence": "Reads the master record a group key points at, to label the line of the summary · ctx.mdm.entity.get({ mdmId }), and collection.getMany to hydrate a whole chart at once · the screen that shows the metric by customer, by professional or by product", "platform": "ready", "evidence": "l1/mdm/layer_3_usecases/mdmFacade.ts:237-243 (facade), :794 (MdmCollection); mdmImplementation.md §10" }
  },

  "storage": {
    "engine": "Either a Postgres table written by a recalculation, or — the way the platform does it — a materialized view declared in viewDefinitions of the module persistence and created by the schema bootstrap.",
    "hypertable": "timescale.hypertable of the TableDefinition names the time column and the chunk interval; without the extension the table is created as an ordinary one.",
    "view": "A ViewDefinition is { moduleId, viewName, statements[] }; the statements run in order after every table and hypertable exists, and a failing one only warns.",
    "purpose": "There is no TablePurpose for derived data today: the persistence contract offers mdm, cadastro, transacao, controle, fila and cache (contracts.ts:4-11)."
  },

  "knownDivergences": {
    "id-and-version-do-not-exist-on-a-view": "The module ontology gives every table `id` and `version` by derivation. A summary materialised as a continuous aggregate has neither — `monitor_bff_execution_agg_minute` carries the bucket, the group keys and the counts, and nothing else. A `ddm` entity is declarable today; the engine that would make the two agree is another task.",
    "measures-are-columns-on-a-view": "In a materialised aggregate the measures really ARE columns of the view: monitor_bff_execution_agg_minute carries totalCount, successCount and the rest (l1/monitor/persistence.ts:98-108). The module ontology keeps a column only where there is an index, so a ddm entity declares its measures inside details; the two shapes meet the day the engine materialises a ddm from this declaration.",
    "retention-days-is-dead": "TableDefinition.retentionDays is declared in the persistence contract and read by no code; retention exists only as a raw add_retention_policy statement.",
    "no-generator-emits-view-definitions": "viewDefinitions is read from any module's persistence entry point, and the only module that ships one is the platform's own monitor. No generated module declares an aggregate yet.",
    "timescale-is-optional": "Every capability of this family that depends on Timescale is skipped with a warning when the extension is absent, and the in-memory runtime of the preview has no aggregate at all — a derived entity simply has no rows there.",
    "no-derived-purpose": "A derived table is declared today with the same TablePurpose as a transactional one, so nothing downstream can tell them apart by the persistence declaration alone; the family of this ontology is what says it."
  }
} as const satisfies DataFamilyOntology;

export default ddm;
