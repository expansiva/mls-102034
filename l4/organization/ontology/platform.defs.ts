/// <mls fileReference="_102034_/l4/organization/ontology/platform.defs.ts" enhancement="_blank"/>

import type { MdmPlatformCatalogArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const mdmPlatformCatalog = {
  "catalogVersion": "2026-09-11-mdm-platform-v1",
  "layers": [
    {
      "layer": "identification",
      "owner": "platform",
      "where": "index columns",
      "fields": [
        "mdmId",
        "subtype",
        "name",
        "status",
        "docType",
        "docId",
        "countryCode",
        "tags"
      ],
      "note": "docType/docId is the legal document, UNIQUE among permanent records. Never a login."
    },
    {
      "layer": "base",
      "owner": "platform",
      "where": "typed keys of the subtype in the document",
      "fields": [
        "contacts[]",
        "addresses[]",
        "aliases[]",
        "relationshipRefs",
        "subtype-specific fields"
      ],
      "note": "Never redeclared by a module."
    },
    {
      "layer": "general",
      "owner": "organization",
      "where": "document key general",
      "fields": [
        "promoted fields"
      ],
      "note": "A field that more than one module needed; promoted by the organization; schema in the solution registry."
    },
    {
      "layer": "module",
      "owner": "the module",
      "where": "document key <moduleId>",
      "fields": [
        "namespace fields only"
      ],
      "note": "Only what nobody else needs. Never identity, document, contact, login."
    }
  ],
  "visibility": {
    "rule": "keys open, content closed",
    "read": "identification + base + general + details[ctx.moduleId] + namespaces[] (names of the other module keys, no content)",
    "unrestricted": "no moduleId or moduleId === 'organization' reads the full document",
    "write": "platform keys + general + details[ctx.moduleId]; any other module key → MDM_FOREIGN_NAMESPACE (400)"
  },
  "identity": {
    "who": "JWT: sub, email, authorities <moduleId>:<actorId>",
    "whereThePersonExists": "record tags/moduleTypes <moduleId>.<EntityId> and details[<moduleId>]",
    "login": {
      "storage": "mdm_tag row",
      "row": {
        "entityType": "MdmEntity",
        "entityId": "<mdmId>",
        "namespace": "login",
        "tag": "<login e-mail>",
        "module": "organization"
      },
      "lookup": "ctx.mdm.identity.findByLogin(email) — indexed mdm_tag (namespace=login)",
      "invariant": "one login e-mail → one record; one record → at most one login row",
      "services": [
        "findByLogin(email) → mdmId | null",
        "setLogin(mdmId, email) — uniqueness MDM_LOGIN_TAKEN; one Person → at most one login row",
        "invite({ mdmId, email, moduleId, actorId }) → { token, expiresAt } — writes login row, asks collab-auth by API key",
        "session.person: { mdmId, email, name } on RequestSessionContext when a login row exists"
      ],
      "pending": [
        "collab-auth emits <module>:<actor> as active_org.teams[].roles (auth.ts:157), not as top-level authorities/roles that bffAuth.ts:38-45 reads"
      ]
    },
    "otherIdentifiers": "one mdm_tag row per identifier, one namespace each (external system id, badge, card)",
    "neverInModule": [
      "login",
      "document",
      "contact"
    ]
  },
  "roles": {
    "meaning": "kind: mdm in a module ontology = a role of that module over a level-1 subtype",
    "tag": "<moduleId>.<EntityId>",
    "createOrAttach": [
      "findByDocument(docType, docId) or findByContact(type, value)",
      "create({ details }) when absent — dedups by document, returns alreadyExists",
      "attachRole(mdmId, role, namespace?)"
    ],
    "ontologyRules": [
      "fields[] holds namespace fields only",
      "storage.idField is the MDM id and stays outside fields[]",
      "displayField is a level-1 field or a namespace field",
      "no lifecycleStates, no transitions — activity is the MDM status"
    ],
    "actorsAreNotRoles": "a profile (receptionist, manager) becomes a Person record only when the business records something about that person"
  },
  "services": [
    {
      "service": "tags",
      "table": "mdm_tag",
      "rows": "many per record",
      "indexes": [
        "(entityType, tag, module)",
        "(entityType, namespace, module)",
        "(module, tag)",
        "unique (entityType, entityId, tag, module)",
        "unique (namespace, tag, module) WHERE namespace='login'"
      ],
      "operations": [
        "mdm.tag.add",
        "mdm.tag.remove",
        "mdm.tag.findByEntity",
        "mdm.tag.findByTag"
      ],
      "useFor": [
        "secondary identifiers (login, external ids)",
        "module markers with a value"
      ],
      "notFor": [
        "role tags — those live in record tags[] via attachRole"
      ]
    },
    {
      "service": "relationships",
      "table": "mdm_relationship",
      "rows": "typed, versioned, validFrom/validTo, status",
      "operations": [
        "mdm.relationship.create",
        "mdm.relationship.list",
        "mdm.relationship.update",
        "facade link / unlink / relatedOfMany"
      ],
      "catalog": "RelationshipCatalog in ontology.ts (26 types)",
      "compactRefs": "relationshipRefs.<key>[] on the record for fast reads",
      "useFor": [
        "a fact about two master records (responsible for, customer of, supplies)"
      ],
      "notFor": [
        "a module join entity between two master records"
      ]
    },
    {
      "service": "prospects",
      "table": "mdm_prospect_index",
      "rows": "transient records, duplicates allowed, TTL",
      "operations": [
        "mdm.prospect.create",
        "mdm.prospect.get",
        "mdm.prospect.list",
        "mdm.prospect.update",
        "mdm.prospect.promoteToEntity"
      ],
      "useFor": [
        "leads and unqualified records before deduplication"
      ]
    },
    {
      "service": "comments",
      "operations": [
        "mdm.comment.add",
        "mdm.comment.edit",
        "mdm.comment.remove",
        "mdm.comment.findByEntity"
      ],
      "useFor": [
        "notes on a master record"
      ],
      "notFor": [
        "a module Comment entity about a master record"
      ]
    },
    {
      "service": "attachments",
      "operations": [
        "mdm.attachment.attach",
        "mdm.attachment.detach",
        "mdm.attachment.findByEntity"
      ],
      "storage": "S3-backed",
      "useFor": [
        "files of a master record (photos, documents)"
      ],
      "notFor": [
        "a module Photo/File entity about a master record"
      ]
    },
    {
      "service": "audit",
      "tables": [
        "mdm audit log (every MDM write, via runMonitoredWrite)",
        "status history"
      ],
      "operations": [
        "audit.home.load",
        "audit.auditLog.load",
        "audit.auditLog.details",
        "audit.statusHistory.load"
      ],
      "rule": "modules never create their own audit, log or history entities for master records",
      "pending": [
        "audit of module-table writes is a platform decision, not a module entity"
      ]
    },
    {
      "service": "statusHistory",
      "operations": [
        "mdm.statusHistory.findByEntity",
        "mdm.statusHistory.findLatest"
      ],
      "useFor": [
        "when a master record changed status, by whom"
      ]
    },
    {
      "service": "numberSequence",
      "operations": [
        "mdm.numberSequence.next"
      ],
      "useFor": [
        "sequential business numbers (order number, invoice number)"
      ],
      "notFor": [
        "a module counter table"
      ]
    },
    {
      "service": "kv",
      "operations": [
        "mdm.kv.get",
        "mdm.kv.put"
      ],
      "useFor": [
        "small organization-wide settings"
      ],
      "notFor": [
        "business entities"
      ]
    }
  ],
  "lookups": [
    {
      "lookup": "get / getMany / hydrateMany by mdmId",
      "cost": "O(1) per id"
    },
    {
      "lookup": "listByType(subtype, …)",
      "cost": "indexed"
    },
    {
      "lookup": "findTagsByTag(entityType, tag, module)",
      "cost": "indexed — use for identifiers looked up per request"
    },
    {
      "lookup": "findByDocument(docType, docId)",
      "cost": "full scan today — not for a per-request path"
    },
    {
      "lookup": "findByContact(type, value)",
      "cost": "full scan today — not for a per-request path"
    }
  ],
  "invariants": [
    "a master record is never deleted: inactivate / reactivate; delete is soft (status, mergedInto)",
    "one legal document → one permanent record; dedup on create; merge keeps mergedInto",
    "a module writes only its namespace (and general when promoted)",
    "writes are versioned (version / expectedVersion)",
    "countryCode comes from the organization (ctx.organization.countryCode), never from UI language",
    "dependency is always module → MDM; the MDM knows no module"
  ]
} as const satisfies MdmPlatformCatalogArtifact;

export type MdmPlatformCatalogType = typeof mdmPlatformCatalog;

export default mdmPlatformCatalog;
