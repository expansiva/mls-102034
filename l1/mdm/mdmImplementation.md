<!-- mls fileReference="_102034_/l1/mdm/mdmImplementation.md" enhancement="_blank" -->
<!-- MDM IMPLEMENTATION MAP — how master data is really stored, indexed, related, extended by modules and exposed. Written 15/09/2026
     from a line-by-line inventory of this folder. Keep it factual: every claim has file:line. Update when persistence.ts, module.ts,
     mdmFacade.ts or mdmSupport.ts change. Functional overview (4 layers, roles, login) stays in README.md; this file is the "how it is built". -->

# MDM — implementation map (`l1/mdm`)

Search keywords: mdm implementation, mdm tables, mdm_documents, details jsonb, module namespace, Record<string, object>, index columns,
version, relationshipRefs, compact keys, ContactChannel, HasContact, attachments, tags, login row, prospects, promotion, merge, searchVector.

## 1. The record: two tables, one document

| table | columns | role |
|---|---|---|
| `mdm_documents` (`persistence.ts:197-222`) | `mdmId TEXT` PK · `version INTEGER` · `details JSONB` | **the record**. One row per master-data record. `unlogged`, mirrored to DynamoDB by write-behind (§6). No index besides the PK. |
| `mdm_documents_entities_index` (`persistence.ts:8-43`) | `mdmId` PK · `subtype` · `name` · `status` · `docType?` · `docId?` · `countryCode` · `tags TEXT[]` · `searchVector TEXT` · `mergedInto?` · `dynamoPk` · `createdAt` · `updatedAt` | **the index** of permanent records: the identification fields copied out of the document so they can be filtered, ordered and searched. 9 btree indexes: subtype, name, status, docType, docId, countryCode, dynamoPk, createdAt, updatedAt (`:33-43`). **No unique index** — not even `(docType, docId)`. |
| `mdm_documents_prospects_index` (`persistence.ts:49-80`) | same identification columns + `promotionSource` · `promotedTo?` · `ttlExpiresAt?` (no `searchVector`) | index of **prospects** (leads, imports, anonymous captures). Same document table, same `mdmId` before and after promotion. |

`version` starts at 1 on create and is `before.version + 1` on every update (`layer_3_usecases/core/DataRecordService.ts:428,466`);
`refreshRelationshipRefs` also bumps it (`layer_3_usecases/mdmSupport.ts:293`). Clients can use it for optimistic concurrency.

**Design rule (old, easy to lose):** a field is a column of the index **only if it needs an index** (filter, sort, uniqueness, search).
Everything else lives inside `details`. Nothing inside the JSONB is indexed today (no GIN, no expression index), so "search by birth month"
or "by city" does not exist until a field is promoted to the index or an index is added.

## 2. Inside `details` — the document

`details` is the whole record; the index columns are **repeated** inside it. Its TypeScript shape is `BaseMdmDetailRecord` (`module.ts:128-149`)
plus one interface per subtype (`module.ts:151-297`; 4 of the 13 subtypes have no dedicated interface and fall into `GenericMdmDetailRecord`
`:258-285`). Four layers, by owner:

| layer | keys | owner | where |
|---|---|---|---|
| identification | `mdmId, subtype, name, status, docType, docId, countryCode, tags[]`, `moduleTypes?`, `mergedInto?` | platform | document **and** index columns |
| base (every subtype) | `aliases[]`, `addresses: AddressValue[]`, `contacts: ContactSummaryValue[]`, `relationshipRefs: CompactRelationshipRefs`, `createdAt`, `updatedAt` | platform | document |
| subtype | Person: `birthDate, gender, nationality, occupation, photoUrl, privacyConsent, notes`; Company: `legalName, tradeName, companyKind, …`; ContactChannel: `contactType, value, isVerified, …` (full list: `l1/mdm/defs/ontology.ts` `*Detail.fields`) | platform | document |
| `general` | `Record<string, unknown>` (`module.ts:71,145`; key `MDM_GENERAL_NAMESPACE = 'general'` `:73`) | **organization** — fields promoted when more than one module needs them; schema lives in the project's solution registry | document |
| **module namespaces** | `[moduleNamespace: string]: unknown` (`module.ts:148`) — **one key per `moduleId`**, i.e. `Record<moduleId, object>` | **the module** — only that module writes it; other modules see the key name, never the content | document |

### 2.1 Module namespaces — `details[moduleId]` (the `Record<string, object>` extension point)

- **Write.** `MdmEntity.attachRole` builds `patch[moduleId] = namespace` (`mdmFacade.ts:543-583`, `:576`). Every create/update goes through
  `prepareMdmWriteDetails` (`:325-333`) → `assertWritableMdmNamespaces` (`:302-323`): a caller with a `moduleId` may write platform keys,
  `general` and **its own key only**; any other module key → `AppError('MDM_FOREIGN_NAMESPACE', 400)` (`:316-321`). A caller with no
  `moduleId` or `moduleId === 'organization'` is unrestricted (`:269-271`, `module.ts:74`).
- **Read.** `projectDetailsForModule` (`mdmFacade.ts:273-300`): platform keys (`MDM_PLATFORM_DETAIL_KEYS`, ~70 literal names `:249-265`) and
  `general` always pass; the caller's own namespace passes with content; other modules' keys are returned **by name only** in the computed
  `namespaces: string[]` (`module.ts:146-147`, stripped before write `:329-330`). A second, shorter copy of the platform key list exists in
  `integration.ts:87-124` (`toMdmLookupResult`) — keep them aligned or derive both.
- **Shape.** Nothing validates the namespace content (§7). The module's own ontology is the only description of what goes there.
- **Identity, document and contact never go into a namespace** (`defs/platform.ts` `identity.neverInModule`); the role tag
  `<moduleId>.<EntityId>` goes into `tags[]` (index column) via `attachRole`.

### 2.2 Value types embedded in the document

Declared as data in `defs/ontology.ts` and as interfaces in `module.ts` — names differ, nothing links them (drift risk):

| data (`defs/ontology.ts`) | interface (`module.ts`) | embedded where |
|---|---|---|
| `Address` `:104` (type enum Residential/Commercial/Billing/Delivery/Other, line1..3, city, stateOrProvince, postalCode, countryCode, formatted, `geolocation {lat,lng}`, isPrimary) | `AddressValue` `:19-32` | `addresses[]` of Person, Company, AssetProperty (and, by template, every subtype) |
| `PrivacyConsent` `:168` | `PrivacyConsentValue` `:34-40` | `Person.privacyConsent` |
| `ContactSummary` `:194` = `{ mdmId, title }` — **a reference, not contact data** | `ContactSummaryValue` `:42-45` | `contacts[]` (see §4: the phone lives in a `ContactChannel` record) |
| `CompactRelationshipRefs` `:213` (22 keys in data) | `CompactRelationshipRefs` `module.ts:76-126` (**48** keys) | `relationshipRefs` (derived, §4) |

## 3. Subtypes (13) and the level-1 catalog

`MdmSubtype` (`defs/ontology.ts:25`): Person, Company, Product, Service, Location, AssetGeneric, AssetVehicle, AssetProperty, AssetEquipment,
Animal, BankAccount, Document, ContactChannel. Fields per subtype: `defs/ontology.ts` `*Detail` constants (string-typed data).

The emitted catalog is **gone** (ns5_43 T6). `l4/organization/ontology/*.defs.ts` (13 subtypes + `index` + `platform`), the emitter
`scripts/emitLevel1Defs.ts` with its drift test, the regex parser `defs/level1FromEngine.ts` and the catalog data `defs/platform.ts` were all
deleted. The solution agents now read `l4/ontology/mdm.defs.ts` directly: `level1Catalog.ts` (mls-102035) derives the shape the NS4 readers
expect from it, and the platform catalog moved verbatim to `l4/ontology/platform.defs.ts`. What is lost with the emitter is the byte-for-byte
drift test between `defs/ontology.ts` / `module.ts` and the catalog; what remains is the subtype-set proof in `defs/mdmOntology.test.ts:47-48`
(`MdmSubtype` ↔ `MdmSubtypeName`, both directions, by the compiler) plus `level1Catalog.test.ts` on the agent side.

The catalog itself now lives in **one file**, `l4/ontology/mdm.defs.ts` (ns5_38, commit `c584e6d`): a single JSON literal with `record`, the four
branches of `groups`, `types`, the 13 `subtypes` as a delta, the 26 `relationships`, and `capabilities` and `rules` as one sentence each. The grammar
is `defs/ontologyTypes.ts`; the reader is `l2/mdm/resolveMdmEntity.ts`, a pure function that assembles the per-entity view (columns, the `details`
tree, links, capabilities and rules) for the screen and for the generator — at l2 because a hosted Studio application does not expose l1.

## 4. Relationships and compact keys

- Tables `mdm_relationship` / `mdm_prospect_relationship` (`persistence.ts:86-156`): `id, fromId, toId, type, role?, metadata JSONB,
  isBidirectional, validFrom DATE, validTo DATE?, status (Active | Inactive | PendingConfirmation), createdAt, updatedAt`. Indexes on fromId,
  toId, type, status. **`role`** is free text — this is where kinship or function goes (parent, spouse, guardian, emergency).
- Catalog: 26 types in `defs/ontology.ts:626-653` (`RelationshipCatalog`: type, from subtypes, to subtypes, bidirectional). `HasContact`
  accepts any subtype → `ContactChannel`. Only `Family` is bidirectional (`mdmSupport.ts:30`).
- `link` (`mdmFacade.ts:679-692`) requires both ends to be permanent entities; `unlink` (`:694-708`) sets `status: 'Inactive'`, never deletes.
- **Compact keys**: `mapRelationshipKeys` (`mdmSupport.ts:121-181`) maps each type × side to a key of `relationshipRefs` (48 distinct keys:
  `PartnersWith`/`Family` use one key for both sides; `CustomerOf`/`SupplierOf` share `{customers, suppliers}`). `buildCompactRelationshipRefs`
  (`:183-215`) fills them from **Active** relationships; `refreshRelationshipRefs` (`:247-314`) rewrites the document only when changed. Never
  write `relationshipRefs` by hand; never copy the key list — derive it from the catalog.
- **Contacts**: a phone/e-mail is a `ContactChannel` record (`contactType`, `value`, `isVerified`) linked by `HasContact`; the owner's document
  carries only `relationshipRefs.contacts` (mdmIds) and the legacy `contacts: ContactSummaryValue[]` (written raw from input,
  `mdmSupport.ts:397,424` — a duplicate of the compact key; candidate for removal). Dedup/login lookups go through the record
  (`findByContact`, §5).

## 5. Lookups and search

| lookup | implementation | cost |
|---|---|---|
| `get`/`getMany`/`hydrateMany` by `mdmId` | index + document store | O(1) |
| `listByType({ type, subtype?, tags?, status?, name?, page, pageSize, sort })` (`layer_3_usecases/mdmFacade.ts:128-140` input) | index table filter; `name` is the only text filter | indexed |
| `findByDocument(docType, docId)` (`mdmFacade.ts:523`) | `mdmEntityIndex.findMany()` then `.find` in JS (`internal/MdmRecordStore.ts:34`) | **full scan** |
| `findByContact(type, value)` (`mdmFacade.ts:531`) | loads all `ContactChannel` records (`MdmRecordStore.ts:47`) | **full scan** |
| `findByLogin(email)` | `mdm_tag` row `namespace='login'`, indexed (§6.1) | indexed |
| `searchVector` | `name + docId + aliases + tags + moduleTypes`, lowercased (`mdmSupport.ts:628-633`); `TEXT`, literal comparison | no fuzzy/semantic search |
| removed on purpose | `mdm.search.run` / `searchHandler.ts` (`layer_2_controllers/routerPublicSurface.test.ts`) | — |

## 6. Cross-cutting services (anchored by `entityType` + `entityId` [+ `module`])

| service | table | usecases | routes (`layer_2_controllers/router.ts`) | notes |
|---|---|---|---|---|
| tags (+ **login row**) | `mdm_tag` (`persistence.ts:439-471`): UNIQUE `(entityType, entityId, tag, module)`; partial UNIQUE `(namespace, tag, module) WHERE namespace='login'` | `tagUsecases.ts`, `identityUsecases.ts` | `mdm.tag.add/remove/findByEntity/findByTag` | login = `{ entityType:'MdmEntity', entityId: mdmId, namespace:'login', tag: email, module:'organization' }` (`identityUsecases.ts:166-176`); `setLogin` → `MDM_LOGIN_TAKEN` 409; `invite` calls collab-auth (`:223-263`); `sessionContext.person` resolved in `l1/server/.../execBff.ts:399-411` |
| comments | `mdm_comment` | `commentUsecases.ts` (≤4000 chars, 1 reply level, 15-min edit) | `mdm.comment.*` | |
| attachments | `mdm_attachment` (`storageKey`, `storageProvider s3|local`, `category`, `deletedAt`, `details JSONB`) | `attachmentUsecases.ts` (attach/detach/find), `attachmentUpload.ts` (bytes → S3 or local disk, presigned GET) | `mdm.attachment.attach/detach/findByEntity`; upload/read HTTP in `l1/server/layer_1_external/storage/attachmentHttp.ts` | **no `module` column**; no upload widget in the base frontend yet; no generated module uses it yet |
| status history | `mdm_status_history` | read `statusHistoryUsecases.ts`; write `core/DataRecordService.ts:272-314` | `mdm.statusHistory.findByEntity/findLatest` | `inactivate`/`reactivate` (`mdmFacade.ts:585-614`) do **not** write it |
| number sequences | `mdm_number_sequence` (UNIQUE `sequenceKey`) | `numberSequenceUsecases.ts` (`SELECT … FOR UPDATE`) | `mdm.numberSequence.next` | key convention `{module}.{entityType}.{scope}` |
| kv | `mdm_kv` | `kvUsecases.ts` | `mdm.kv.get/put` | no data def |
| audit | `mdm_audit_log` | write-only `core/DataRecordService.ts:158-201` | none | no reader; `diff` only in the Dynamo copy |
| outbox / Dynamo mirror | `mdm_outbox` → `internal/WriteBehindWorker.ts` → Dynamo; `RestoreFromDynamoUsecase.ts` back | | | `mdm_replication_failures` declared, never written; `mdm_error_log`, `mdm_monitoring_write` write-only |

## 7. What is validated on write — and what is not

Validated (`mdmSupport.ts:517-546`): `name` non-empty; `legalName` for Company; `bankRoutingNumber` for US bank accounts; `contactType`+`value`
for ContactChannel. Everything else is `Object.assign(detail, rawInput)` (`mdmSupport.ts:410`): `addresses`, `contacts`, `privacyConsent`,
`general`, module namespaces, `subtype`/`docType`/`status` (casts) enter **unchecked**. `name` absent becomes the string `"undefined"` (`:359`).
Person in BR/EU without valid consent is forced `Inactive` (`normalizeStatus` `:492-514`). Validation by schema is the job of the ontology
rewrite: derive a JSON Schema from `l4/ontology/mdm.defs.ts` and apply it here — until then, modules must validate before calling `ctx.mdm`.
The ontology already says so: rule `rule-document-shape-validated` is listed with `platform: missing`.

## 8. Prospects, promotion, merge, delete

- `prospect.create` → index of prospects, status `New` (`mdmFacade.ts:714-726`); statuses `New | InProgress | PendingMerge | Promoted | Expired | Discarded`.
- `promoteToEntity` (`entityPersistence.ts:357-500`): dedup by `(docType, docId)` for Person/Company and `(contactType, value)` for ContactChannel;
  duplicate → `PendingMerge` + queue `mdm.pending-merge`; no duplicate → moves the index row, migrates relationships, **same `mdmId`**.
- `mergeEntity` (`entityPersistence.ts:502-549`: loser `status: 'Merged'`, `mergedInto`) exists but is **not exported by the facade nor routed**.
- `delete` (`mdmFacade.ts:616-677`) is physical; blocked by active relationships (`MDM_DELETE_BLOCKED_BY_RELATIONSHIPS` 409).

## 9. Source of truth today — three copies, no binding

`defs/ontology.ts` (data, string types) · `module.ts` (interfaces, checked by tsc against runtime code) · `persistence.ts` (DDL). The fourth
copy, the emitted `l4/organization/ontology/*.defs.ts`, was deleted in ns5_43 T6 (see §3). Known mismatches: `Address`/`AddressValue`, `PrivacyConsent`/`PrivacyConsentValue`,
`ContactSummary`/`ContactSummaryValue`, `CompactRelationshipRefs` 22 vs 48 keys, `UNIQUE(docType, docId)` promised (`defs/ontology.ts:291-296`) but
absent, `searchVector: tsvector` vs `TEXT`, table `mdm_relationship_documents` cited but non-existent, JSON service defs in PascalCase vs
camelCase columns. The single source is now `l4/ontology/mdm.defs.ts` (`defs/ontologyTypes.ts` for the grammar), which lists every one of these
divergences in `knownDivergences` instead of hiding them; interfaces, index DDL and validation are still to be derived from it.

## 10. Reading a record from a module (what a generated backend gets)

`ctx.mdm.entity.get({ mdmId })` → `{ id, index: {…identification columns…}, details: {…document projected for this module…} }`. Inside `details`:
platform keys, `general`, your own `details[<moduleId>]` with content, `namespaces: [other module ids]`. Write back with
`ctx.mdm.entity.update({ mdmId, details: { <your keys> } })`; write your namespace with `attachRole(mdmId, '<module>.<Entity>', namespace)`.
Do not read `details.<field>` and `details.<module>.<field>` "whichever exists" — the ontology says which layer a field lives in.

## 11. The minute tick (what a generated backend may export)

A module may export `onTick(ctx, now)` from its persistence file. The platform collects it the same
way it collects `viewDefinitions` (`l1/server/layer_1_external/persistence/registry.ts:563`,
`loadModuleTickHandlers`) and calls it **once a minute**, in series, with one `try/catch` per module —
one module failing does not stop the others, and a tick is skipped while the previous one still runs
(`l1/server/layer_1_external/transport/http/startServer.ts:592`, `ModuleTickLoop`). The loop runs in
`postgres` mode when `env.tickEnabled`, and is off in the `memory` preview.

Nothing is central: no alert table, no queue, no external cron. What the module does each minute, and
where it records that it did it, is the module's own `tdm` table. `evaluateSchedule(schedule, now,
lastRun)` (`l1/server/layer_2_application/schedule/evaluateSchedule.ts`) is a pure helper that reads
the prose schedule a `workflows.defs.ts` carries ("todo dia", "every month", "a cada N minutos") and
returns the occurrence due at or before `now`, or `null` when the prose is not a schedule.
