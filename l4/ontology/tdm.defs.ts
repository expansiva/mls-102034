/// <mls fileReference="_102034_/l4/ontology/tdm.defs.ts" enhancement="_blank"/>
/**
 * The catalog a TRANSACTIONAL table of a module starts from — the movement, the event, the operation
 * that only exists because the module exists (ns5_46).
 *
 * `mdm.defs.ts` next door is the same idea for the master record: a papel of a module copies the platform
 * record of its subtype and tightens it. A table had nothing to copy from, so each call of the fan-out
 * decided alone what a table may do, and invented capability ids nobody could check
 * (`agentNs5Ontology.ts:316`, before this file existed). This is the other half.
 *
 * A row is `{ id, version, <indexed columns>, details }`: a column exists because something filters,
 * sorts, deduplicates or searches by it, and everything else lives in the `details` document.
 *
 * Every capability carries the status of the PLATFORM, measured, with the file and line where it was
 * measured. `ready` is what a module can use today; `partial` works with a caveat written in the
 * sentence; `missing` is declared so nobody promises it. Membership of this catalog is what makes an id
 * legal for a `tdm` table — not its readiness.
 *
 * Everything below the `export const` is ONE JSON literal, double-quoted, with no comments inside it, so
 * that the same extractor the screens and the agents use (`extractNs4ClassicJsonObject` + `JSON.parse`)
 * reads it whole. It is checked by `l1/mdm/defs/dataFamilyOntology.test.ts`, which imports this file —
 * `l4` enters the `tsc` program only through an import from `l1`.
 */

import type { DataFamilyOntology } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const tdm = {
  "schemaVersion": "2026-09-17-tdm-ontology-v1",
  "family": "tdm",
  "title": "Transactional data of a module",
  "description": "The movement, the event, the operation of one module: an appointment, an order, a payment, a stock move. The module writes it and owns it; no other module reads it by name.",

  "record": {
    "fields": {
      "id": { "type": "uuid", "required": true, "derived": true, "indexed": true, "description": "The row id, written by the engine. Every foreign key that points at this table points at it." },
      "version": { "type": "integer", "required": true, "derived": true, "description": "Optimistic concurrency counter of the row. Declared on every table; see knownDivergences for what the engine does with it today." },
      "<column>": { "type": "string", "indexed": true, "description": "One key per column the module declares. A field is a column ONLY when something filters, sorts, deduplicates or searches by it: the foreign keys, the lifecycle status, the dates and the values a list really orders by. A column with no index does not belong here." },
      "details": { "type": "object", "required": true, "description": "The JSONB document with everything else: free text, amounts that are only displayed, nested objects and the collections embedded by composition. Nothing filters by what is inside it." }
    }
  },

  "recommendations": [
    "`id` and `version` are written for you: never ask for them and never redeclare them.",
    "A field is a column only when something filters, sorts, deduplicates or searches by it. Everything else goes inside `details`, as a tree, however deep the business needs.",
    "Every foreign key is a column of `type: record` and is indexed — a key nobody can filter by is not a key.",
    "What belongs to the master record — name, document, contact, address — is never copied into a column here. The column carries the id of the record, and `read.mdmRecord` reads the rest.",
    "A number a person quotes (an order number, a ticket number, a receipt number) comes from `sequence.next` over `mdm_number_sequence`. Never a counter of your own, and never a column that stores the last number issued.",
    "A lifecycle is an indexed `status` column whose `values` cover the declared states; moving between them is the capability `transition`.",
    "Uniqueness is enforced on columns, through `uniqueKeys` — the engine turns it into a UNIQUE index.",
    "A value recalculated from OTHER rows (a total of the day, an average, a position in a ranking) is not a column of this table: it is a `ddm` entity. A value that follows from this same row (a status implied by its own dates, a total of its own embedded lines) is a field of this row marked `derived`."
  ],

  "capabilities": {
    "read.byId": { "source": "table", "sentence": "Reads one row when the id is already known · findOne({ where: { id } }) on the repository of the table · any screen that already holds the id", "platform": "ready", "evidence": "l1/server/layer_1_external/data/moduleDataRuntime.ts:77" },
    "locate.byColumn": { "source": "table", "sentence": "Lists rows filtered by equality on indexed columns, ordered and paged · findMany({ where, orderBy, limit, offset }); the page is 20 by default and is cut at 200, and the envelope declares the size actually used · any list screen", "platform": "ready", "evidence": "moduleDataRuntime.ts:19-30 (input), :78 (findMany), :33-35 and :48-52 (page)" },
    "locate.byText": { "source": "table", "sentence": "Finds rows whose column contains the typed text, anywhere in the string · findMany({ ilike }), one case-insensitive substring per column, ILIKE in Postgres · a search box over a list · no index serves a leading wildcard, so it reads the table", "platform": "partial", "evidence": "moduleDataRuntime.ts:21-22" },
    "count": { "source": "table", "sentence": "Counts the rows a filter matches, ignoring the page · count(), the same WHERE as findMany · a total on a list header or a badge", "platform": "ready", "evidence": "moduleDataRuntime.ts:79-80" },
    "listByForeignKey": { "source": "table", "sentence": "Lists the rows that point at one record, or at many records at once · findMany({ where: { <fk> } }), and findManyByValues({ field, values }) to fill a whole list without one query per line · a record screen showing its movements", "platform": "ready", "evidence": "moduleDataRuntime.ts:78, :81-85" },
    "create": { "source": "table", "sentence": "Writes a new row · insert({ record }); upsert when the same key may arrive twice · whoever performs the operation", "platform": "ready", "evidence": "moduleDataRuntime.ts:86-87" },
    "update": { "source": "table", "sentence": "Changes part of a row · update({ where, patch }), the patch written as it comes · whoever maintains the movement", "platform": "ready", "evidence": "moduleDataRuntime.ts:88" },
    "delete": { "source": "table", "sentence": "Removes the row physically · delete({ where }) · an administrator · nothing blocks it: unlike the master record, a module table has no relationship check before a delete", "platform": "ready", "evidence": "moduleDataRuntime.ts:89; compare mdm.capabilities.delete (MDM_DELETE_BLOCKED_BY_RELATIONSHIPS)" },
    "transition": { "source": "table", "sentence": "Moves the row from one lifecycle state to the next · an update of the indexed status column; the engine has no transition primitive, so the rule that guards it lives in the module · whoever the transition names", "platform": "partial", "evidence": "moduleDataRuntime.ts:88; no transition or state machine anywhere in l1/server/layer_1_external/data" },
    "uniqueKey": { "source": "table", "sentence": "Refuses a second row with the same key · a UNIQUE index of the module TableDefinition, partial (`where`) when the rule only applies to part of the rows · the engine, on write", "platform": "ready", "evidence": "l1/server/layer_1_external/persistence/contracts.ts:35-42; schemaBootstrap.ts:153" },
    "transaction": { "source": "table", "sentence": "Writes several rows all or nothing · runInTransaction over the module data runtime · whoever writes more than one table in one operation · a real transaction against Postgres; in the in-memory runtime of the preview it only calls the callback, so nothing is rolled back there", "platform": "partial", "evidence": "moduleDataRuntime.ts:577-585 (postgres) against :538-540 (memory)" },
    "read.mdmRecord": { "source": "platform", "sentence": "Reads the master record a column of this table points at · ctx.mdm.entity.get({ mdmId }), and collection.getMany to hydrate a whole list at once · every screen that shows the name of the customer, the professional or the product behind a movement", "platform": "ready", "evidence": "l1/mdm/layer_3_usecases/mdmFacade.ts:237-243 (facade), :794 (MdmCollection); mdmImplementation.md §10" },
    "sequence.next": { "source": "platform", "sentence": "Issues the next number of a counter, such as an order or a receipt number · mdm_number_sequence with SELECT … FOR UPDATE, key {module}.{entityType}.{scope} · the module, on create · the routine mdm.numberSequence.next is routed and works, but the facade a module usecase holds does not expose it, so today it is reached over the BFF", "platform": "partial", "evidence": "l1/mdm/layer_3_usecases/numberSequenceUsecases.ts:39-60; layer_2_controllers/router.ts:66; absent from MdmFacade (mdmFacade.ts:237-243)" },
    "attach.document": { "source": "platform", "sentence": "Stores a photo, a scan or a signed file against this row, by category · mdm_attachment anchored by entityType and entityId, which are free text, so the row of a module table can be the anchor; upload to S3 or local disk with a presigned GET · whoever maintains the movement · the table has no module column and no generated module uses it yet", "platform": "partial", "evidence": "persistence.ts:536-556 (entityType TEXT); mdmFacade.ts:973-999 (facade attachment); mdmImplementation.md §6" },
    "comment": { "source": "platform", "sentence": "Leaves a note on this row, with one level of reply and a 15-minute edit window · mdm_comment anchored by entityType, entityId and module · whoever maintains the movement · routed as mdm.comment.*, and not on the facade, so a usecase reaches it over the BFF", "platform": "partial", "evidence": "persistence.ts:493-511; layer_2_controllers/router.ts:59-62; absent from MdmFacade (mdmFacade.ts:237-243)" },
    "tag": { "source": "platform", "sentence": "Marks this row with free labels inside the module namespace, and finds every row carrying one · mdm_tag, UNIQUE (entityType, entityId, tag, module), index (entityType, tag, module) · a module that needs a secondary key of its own · routed as mdm.tag.*, and not on the facade", "platform": "partial", "evidence": "persistence.ts:446-465; layer_2_controllers/router.ts:70-73; absent from MdmFacade (mdmFacade.ts:237-243)" },
    "statusHistory.read": { "source": "platform", "sentence": "Shows when this row changed status and who changed it · mdm_status_history, read by mdm.statusHistory.findByEntity · the record screen · nothing writes a row for a module table: the history is written only by the MDM record service, so the read comes back empty until the module writes it itself", "platform": "missing", "evidence": "persistence.ts:404-423 (table); StatusHistoryService (core/DataRecordService.ts:272) is called only from l1/mdm (DataRecordService.ts:540, internal/entityPersistence.ts:400, :475, :541), never from the module data runtime; mdmImplementation.md §6" },
    "audit": { "source": "platform", "sentence": "Says who changed what, and when · mdm_audit_log, insert only · an administrator · a write to a module table goes through the module data runtime, which writes no audit row; only MDM writes are audited", "platform": "missing", "evidence": "AuditLogService (core/DataRecordService.ts:158) is called only from l1/mdm usecases (numberSequenceUsecases.ts:108, identityUsecases.ts:189, internal/relationshipPersistence.ts:82, and the record service itself); no audit reference anywhere in moduleDataRuntime.ts; mdmImplementation.md §6" }
  },

  "storage": {
    "engine": "One Postgres table per entity, declared as a TableDefinition in the persistence file of the module and created by the schema bootstrap (l1/server/layer_1_external/persistence/schemaBootstrap.ts).",
    "tableName": "The physical name is namespaced by project and module — mls<projectId>_<module>_<entity>; the logical name, the one a repository is asked for, is the entity in lowercase (registry.ts:405-420).",
    "details": "details is a JSONB column of the same row. Nothing filters by what is inside it; a field that has to be filtered is promoted to a column of its own.",
    "indexes": "indexes[] of the TableDefinition, unique and partial (where) supported; the primary key is id.",
    "purpose": "TablePurpose 'transacao' is the one that names this family in the persistence contract (contracts.ts:4-11)."
  },

  "knownDivergences": {
    "version-never-bumped": "version is declared on every row and NO write path increments it: update writes the patch as it comes (moduleDataRuntime.ts:88). Optimistic concurrency on a module table is the target, not today's behaviour.",
    "no-audit-for-module-tables": "mdm_audit_log is written only by the MDM record service; a write through the module data runtime leaves no trace.",
    "no-status-history-for-module-tables": "mdm_status_history is written only by the MDM record service, so a lifecycle of a module table has no history unless the module writes one of its own.",
    "ilike-is-a-scan": "locate.byText uses ILIKE with a leading wildcard, which no B-tree index serves; there is no trigram index on a module table.",
    "memory-transaction-is-a-noop": "runInTransaction in the in-memory runtime just calls the callback, so a preview never rolls anything back (moduleDataRuntime.ts:538-540).",
    "platform-services-not-on-the-facade": "sequence.next, comment and tag are routed and are absent from MdmFacade, which is what a module usecase holds; attach.document is the only one of the four the facade exposes."
  }
} as const satisfies DataFamilyOntology;

export default tdm;
