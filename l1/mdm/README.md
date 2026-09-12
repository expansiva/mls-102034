# MDM (`mls-102034/l1/mdm`) — master data of the organization

Shared master-data engine for every client project on the VM. Tables are **not** prefixed by project or
module: treat them as organization-wide state. This file is the functional map; read it before touching
the engine, generating code that calls `ctx.mdm`, or writing an l4 that declares `kind: mdm`.

Related: `defs/ontology.ts` (catalogs and table definitions, the source of truth for shapes),
`layer_3_usecases/mdmFacade.ts` (what modules call), `layer_2_controllers/router.ts` (routes),
`persistence.ts` (tables, indexes, write modes), `../sql/001_init.sql`, `../docs/appEnvAndAuth.md`
(identity and authorities). Agent-facing summary: `mls-102035/l2/agentNewSolution5/skills/mdm.md`.

## 1. What a record is

One record per real-world thing: a person, a company, a product, a service, a place, an asset, an animal,
a bank account, a document, a contact channel. `subtype` ∈ `MdmSubtype` (13 values, `defs/ontology.ts:25`).
Status: `Active | Inactive | Merged | Blocked`. Records are never deleted (see §9).

`details` has four layers; only the last one belongs to a module:

| layer | where | who owns it | examples |
|---|---|---|---|
| identification | index columns (`mdmId`, `subtype`, `name`, `status`, `docType`, `docId`, `countryCode`, `tags`) | platform | `docType: 'CPF'`, `docId` |
| base | typed keys of the subtype inside the document | platform | `contacts[]`, `addresses[]`, `aliases[]`, `birthDate`, `legalName`, `sku`, `relationshipRefs` |
| `general` | document key `general` (`MdmGeneralNamespace`) | organization (schema in the solution registry, l4) | a field two modules promoted |
| module namespace | document key `<moduleId>` | that module | `mensalidadesAcademia: { plano, dueDay }` |

`general` is reserved: the engine keeps the key and does not filter it; field schema is not enforced here.
`docType/docId` is the **national/legal document** and is `UNIQUE (docType, docId)` among permanent
records (`MdmEntity`, `defs/ontology.ts:283`). Prospects may duplicate it until promotion.

## 2. Keys open, content closed (visibility)

`ctx.mdm` reads (`get`, `getMany`, `hydrateMany`, `listByType`) return identification + base + `general` +
the caller's `<ctx.moduleId>` namespace, plus `namespaces: string[]` naming every **other** module key
(names only, no content). No `moduleId`, or `moduleId === 'organization'`: the platform / super module sees
the full document, still with `namespaces`. Writes accept platform keys + `general` + `<ctx.moduleId>`
only; any other module key → `AppError('MDM_FOREIGN_NAMESPACE', 400)`. `namespaces` is computed on read
and stripped on write. The caller module comes from the BFF routine (`execBff` stamps `ctx.moduleId`).

## 3. Roles: how a module "has" a person, a product, a place

A module does not own master data. It declares a **role** over a subtype: the record gets the tag
`<moduleId>.<EntityId>` (also listed in `moduleTypes`) and the module writes its namespace. Reading
`moduleTypes` on a record answers "in which modules does this record exist, and as what".

Create-or-attach (`layer_3_usecases/mdmFacade.ts`):

```
ctx.mdm.entity.findByDocument(docType, docId)      // permanent record by legal document
ctx.mdm.entity.findByContact(contactType, value)   // by a ContactChannel value (e-mail, phone) — see §7 cost
ctx.mdm.entity.create({ details })                  // dedups by document; returns alreadyExists
ctx.mdm.entity.attachRole(mdmId, role, namespace?) // adds `<moduleId>.<role>` without duplicating; writes the caller namespace
ctx.mdm.entity.update / inactivate / reactivate / delete(soft) / link / unlink
```

`attachRole` refuses a tag for another module (`MDM_FOREIGN_NAMESPACE`). Writes use optimistic
concurrency: `update` takes `expectedVersion` and fails on a stale version.

## 4. Relationships between records

`MdmRelationship` (`defs/ontology.ts:379`): `{ id, fromId, toId, type, role?, metadata?, isBidirectional,
validFrom, validTo, status }`, typed by the catalog `RelationshipType` (26 types: `Family`, `GuardianOf`,
`CustomerOf`, `SupplierOf`, `Employs`, `MemberOf`, `Owns`, `LocatedAt`, `HasContact`, `Signed`…), versioned,
Postgres as source of truth, plus compact keys on the record (`relationshipRefs.family`, `.guardians`,
`.customers`…) for fast reads. Facade: `link`, `unlink`, `MdmCollection.relatedOfMany`, routes
`mdm.relationship.create|list|update`. Prospects have their own table and are migrated on promotion.

Use a relationship, not a module join entity, when the fact is about two master records ("this person is
responsible for that person", "this company supplies that product"). `GuardianOf` is `Person → Person | Animal`.

## 5. Tags as an index: many rows per record

Besides `tags[]` on the record, the table `mdm_tag` (`persistence.ts:439`, `module.ts:476`) holds many
rows per entity: `{ entityType, entityId, tag, namespace, module, createdBy… }`, indexed by
`(entityType, tag, module)`, `(entityType, namespace, module)`, `(module, tag)`, unique on
`(entityType, entityId, tag, module)`. Usecases `addTag`, `removeTag`, `findTagsByEntity`, `findTagsByTag`
(routes `mdm.tag.*`). `findTagsByTag` is an indexed column lookup — this is the place for **secondary
identifiers**: login e-mail, external system ids, badge numbers, one namespace each.

**Login (decided 11/09/2026):** a person who signs in has one row `{ entityType: 'MdmEntity', entityId: mdmId,
namespace: 'login', tag: <login e-mail>, module: 'organization' }`. The JWT carries the login e-mail and the
authorities `<moduleId>:<actorId>`; the MDM carries where the person exists (`moduleTypes`) and each
module's data (`details[<moduleId>]`). Unique across entities: `(namespace='login', tag, module)`.
Facade: `ctx.mdm.identity.findByLogin` / `setLogin` / `invite` — see §11.

## 6. Prospects and promotion

`MdmProspect` (`defs/ontology.ts:344`): transient records (`New | InProgress | PendingMerge | Promoted |
Expired | Discarded`, `ttlExpiresAt`, `promotionSource`), own index table, duplicates allowed.
`ctx.mdm.prospect.create|get|update|listByType|promoteToEntity`; promotion dedups against permanent
records (`PendingMerge` when a candidate exists) and migrates relationships.

## 7. Lookups and their cost (measured 11/09/2026)

| lookup | how it runs today | cost |
|---|---|---|
| `get` / `getMany` / `hydrateMany` by `mdmId` | index + document store | O(1) per id |
| `listByType(subtype, …)` | index table filter | indexed |
| `findByDocument(docType, docId)` | `mdmEntityIndex.findMany()` then `.find` in JS (`MdmRecordStore.ts:34`) | **full scan** |
| `findByContact(type, value)` | loads all `ContactChannel` records and their documents, compares in JS (`MdmRecordStore.ts:47`) | **full scan** |
| `findTagsByTag(entityType, tag, module)` | `mdm_tag` indexed columns | indexed |

Pending: column index for `(docType, docId)` and a contact index. Until then, do not build a per-request
path on `findByDocument` / `findByContact`; use the tag table for identifiers that must be looked up often.

## 8. Other services on the record

Comments (`mdm.comment.*`), attachments (`mdm.attachment.*`, S3-backed), audit log (every write goes through
`runMonitoredWrite` + `AuditLogService`), status history (`mdm.statusHistory.*`), number sequences
(`mdm.numberSequence.next`), key-value (`mdm.kv.get|put`). All scoped by `module` on the row.

**Audit is a platform service.** The `audit` module (`../audit/`, routes `audit.home.load`, `audit.auditLog.load`,
`audit.auditLog.details`, `audit.statusHistory.load`) reads the MDM audit log and status history filtered by module.
A client module never creates its own audit, log or history entity for master records. Whether writes to module
tables are audited by the platform is a pending platform decision, not something a module solves with an entity.

## 9. Invariants

- **Never delete** a master record: `inactivate` / `reactivate`; `delete` is soft (`status`, `mergedInto`).
- **One document, one record** among permanent records; dedup on create; merge keeps `mergedInto`.
- **A module writes only its namespace** (and `general` when promoted); identity and base are the
  organization's. Never store a login, a document or a contact in a module namespace.
- **Actors are not records.** A receptionist is a profile with authorities; she becomes a `Person` record
  only when the business records something about her.
- **Versioned writes** (`version`, `expectedVersion`); Postgres index is the query surface, the document
  store (`MdmDocument`, three columns) holds all fields; write modes per table in `persistence.ts`
  (`sync` for indexes, `writeBehind` + outbox for hot-backup tables).
- `ctx.organization.countryCode` is the installation/org country (env `ORGANIZATION_COUNTRY_CODE` /
  `COUNTRY_CODE`, default `US`), never derived from UI language.

## 10. File map

| what | where |
|---|---|
| catalogs (`MdmSubtype`, `DocType`, `RelationshipType`, statuses) and table shapes | `defs/ontology.ts` |
| **platform catalog** (layers, visibility, identity/login, roles, services with use-for/not-for, lookup costs, invariants) — data, rendered into `l4/organization/ontology/platform.defs.ts` | `defs/platform.ts` |
| level-1 artifact types (`Ns4Level1EntityArtifact`, `MdmPlatformCatalogArtifact`) | `defs/level1Types.ts` |
| parser that builds level-1 artifacts from `ontology.ts` / `module.ts` / `mdmSupport.ts` | `defs/level1FromEngine.ts` |
| emitter (Node, no LLM) and byte-for-byte drift test | `scripts/emitLevel1Defs.ts`, `scripts/emitLevel1Defs.test.ts` |
| record types (`BaseMdmDetailRecord`, `PersonDetailRecord`, …, `MdmTagRecord`, params) | `module.ts` |
| tables, indexes, write modes | `persistence.ts`, `tableNames.ts`, `../sql/001_init.sql` |
| facade (`ctx.mdm`): `MdmEntity`, `MdmProspect`, `MdmCollection`, `MdmAttachment`, `MdmIdentity`, `createMdmFacade` | `layer_3_usecases/mdmFacade.ts` |
| lookups, persistence of records and relationships | `layer_3_usecases/internal/*` |
| tags, comments, attachments, kv, sequences, status history | `layer_3_usecases/*Usecases.ts` |
| HTTP routes (`mdm.entity.*`, `mdm.prospect.*`, `mdm.relationship.*`, `mdm.tag.*`, …) | `layer_2_controllers/router.ts` |
| Postgres / DynamoDB / memory runtimes, write-behind worker, restore | `layer_1_external/**` |
| level-1 defs generated from this engine for the agents | `l4/organization/ontology/*.defs.ts` (subtypes, `index.defs.ts`, `platform.defs.ts`) |

## 11. Identity facade

`ctx.mdm.identity` is the platform login surface. A module never looks up a person by e-mail.

| method | effect |
|---|---|
| `findByLogin(email)` | indexed `mdm_tag` lookup, `namespace='login'`, module `organization` → `mdmId` or `null`. Cached (`identity:login:<email>` → `{mdmId, name}`). |
| `setLogin(mdmId, email)` | writes that login row; refuses `MDM_LOGIN_TAKEN` if the e-mail belongs to another person; replaces the previous login of the same person (one row). Invalidates the cache. |
| `invite({ mdmId, email, moduleId, actorId })` | `setLogin` then asks collab-auth (`POST /internal/orgs/:id/invites`, API key, org role `member`) and returns `{ token, expiresAt }`. No password: accept is OAuth with the same e-mail. |

`execBff` fills `sessionContext.person: { mdmId, email, name }` and `sessionContext.actorId = mdmId` when the verified e-mail has a login row. Without a row, `person` is absent and `actorId` stays as before. Telemetry `requestMeta.userId` remains the e-mail.

Cache implementation is chosen by capability: Redis when `REDIS_URL` is set (VM), in-memory otherwise (lima). TTL default 300 s (`IDENTITY_CACHE_TTL_SECONDS`).

Type exported for l1/l2: `PlatformSessionPerson` from `l1/server/layer_2_controllers/contracts.ts`.
