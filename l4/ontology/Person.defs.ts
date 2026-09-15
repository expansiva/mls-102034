/// <mls fileReference="_102034_/l4/ontology/Person.defs.ts" enhancement="_blank"/>

import type { MdmEntityArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmEntityPerson = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "entity",
  "entityId": "Person",
  "title": "Person",
  "description": "Subtype Person — natural persons: customers, employees, partners, dependents.",
  "displayField": "details.name",
  "fields": {
    "id": {
      "title": "Id",
      "description": "mdmId; stable from creation through promotion.",
      "required": true,
      "origin": "derived",
      "layer": "column",
      "type": "uuid"
    },
    "version": {
      "title": "Version",
      "description": "Bumped by the engine on every write; usable for optimistic concurrency.",
      "required": true,
      "origin": "derived",
      "layer": "column",
      "type": "integer"
    },
    "details": {
      "title": "Document",
      "description": "The record as the engine stores and returns it. Identification fields are repeated as index columns. Two keys are reserved and not listed here: `general`, the organization layer, and one key per module id — `details['<moduleId>']: Record<moduleId, object>`, the module namespace, which only that module writes and other modules see by name only.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "object",
      "fields": {
        "subtype": {
          "title": "Subtype",
          "required": true,
          "origin": "derived",
          "layer": "column",
          "type": "enum",
          "values": [
            {
              "value": "Person",
              "title": "Person"
            }
          ],
          "indexed": true
        },
        "name": {
          "title": "Name",
          "required": true,
          "origin": "nivel1",
          "layer": "column",
          "type": "string",
          "indexed": true
        },
        "status": {
          "title": "Status",
          "required": true,
          "origin": "derived",
          "layer": "column",
          "type": "enum",
          "values": [
            {
              "value": "Active",
              "title": "Active"
            },
            {
              "value": "Inactive",
              "title": "Inactive"
            },
            {
              "value": "Merged",
              "title": "Merged"
            },
            {
              "value": "Blocked",
              "title": "Blocked"
            }
          ],
          "indexed": true
        },
        "moduleTypes": {
          "title": "Module Types",
          "required": false,
          "collection": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "docType": {
          "title": "Doc Type",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "column",
          "type": "enum",
          "values": [
            {
              "value": "SSN",
              "title": "SSN"
            },
            {
              "value": "EIN",
              "title": "EIN"
            },
            {
              "value": "Passport",
              "title": "Passport"
            },
            {
              "value": "DriversLicense",
              "title": "DriversLicense"
            },
            {
              "value": "NationalId",
              "title": "NationalId"
            },
            {
              "value": "CPF",
              "title": "CPF"
            },
            {
              "value": "CNPJ",
              "title": "CNPJ"
            },
            {
              "value": "VAT",
              "title": "VAT"
            },
            {
              "value": "Other",
              "title": "Other"
            }
          ],
          "indexed": true
        },
        "docId": {
          "title": "Doc Id",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "column",
          "type": "string",
          "indexed": true
        },
        "countryCode": {
          "title": "Country Code",
          "required": true,
          "origin": "nivel1",
          "layer": "column",
          "type": "string",
          "indexed": true
        },
        "tags": {
          "title": "Tags",
          "required": true,
          "collection": true,
          "origin": "derived",
          "layer": "column",
          "type": "string"
        },
        "aliases": {
          "title": "Aliases",
          "required": true,
          "collection": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "contacts": {
          "title": "Contacts",
          "required": true,
          "collection": true,
          "origin": "derived",
          "layer": "document",
          "type": "object",
          "of": "ContactSummary"
        },
        "addresses": {
          "title": "Addresses",
          "required": true,
          "collection": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "object",
          "of": "Address"
        },
        "mergedInto": {
          "title": "Merged Into",
          "required": false,
          "nullable": true,
          "origin": "derived",
          "layer": "column",
          "type": "string"
        },
        "createdAt": {
          "title": "Created At",
          "required": true,
          "origin": "derived",
          "layer": "column",
          "type": "string",
          "indexed": true
        },
        "updatedAt": {
          "title": "Updated At",
          "required": true,
          "origin": "derived",
          "layer": "column",
          "type": "string",
          "indexed": true
        },
        "relationshipRefs": {
          "title": "Relationship references",
          "description": "Compact keys the engine recomputes on every link and unlink. Never written by hand.",
          "required": true,
          "origin": "derived",
          "layer": "document",
          "type": "object",
          "fields": {
            "assignments": {
              "title": "Assignments",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company",
                "Service"
              ]
            },
            "attendedServices": {
              "title": "Attended Services",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Service"
              ]
            },
            "bankAccounts": {
              "title": "Bank Accounts",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "BankAccount"
              ]
            },
            "contacts": {
              "title": "Contacts",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "ContactChannel"
              ]
            },
            "documents": {
              "title": "Documents",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Document"
              ]
            },
            "employers": {
              "title": "Employers",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company"
              ]
            },
            "family": {
              "title": "Family",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person"
              ]
            },
            "guardians": {
              "title": "Guardians",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person"
              ]
            },
            "locations": {
              "title": "Locations",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "AssetProperty"
              ]
            },
            "managedOrganizations": {
              "title": "Managed Organizations",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company",
                "Service"
              ]
            },
            "memberships": {
              "title": "Memberships",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company"
              ]
            },
            "offeredServices": {
              "title": "Offered Services",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Service"
              ]
            },
            "ownedAssets": {
              "title": "Owned Assets",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "AssetGeneric",
                "AssetVehicle",
                "AssetProperty",
                "AssetEquipment"
              ]
            },
            "partners": {
              "title": "Partners",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company",
                "Person"
              ]
            },
            "pets": {
              "title": "Pets",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person",
                "Animal"
              ]
            },
            "reportManagers": {
              "title": "Report Managers",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person"
              ]
            },
            "reports": {
              "title": "Reports",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person"
              ]
            },
            "suppliers": {
              "title": "Suppliers",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company"
              ]
            },
            "taughtServices": {
              "title": "Taught Services",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Service"
              ]
            }
          }
        },
        "birthDate": {
          "title": "Birth Date",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "date"
        },
        "gender": {
          "title": "Gender",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "Male",
              "title": "Male"
            },
            {
              "value": "Female",
              "title": "Female"
            },
            {
              "value": "NonBinary",
              "title": "NonBinary"
            },
            {
              "value": "NotDisclosed",
              "title": "NotDisclosed"
            }
          ]
        },
        "nationality": {
          "title": "Nationality",
          "description": "ISO 3166-1 alpha-2 country of nationality.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "occupation": {
          "title": "Occupation",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string",
          "maxLength": 120
        },
        "photoUrl": {
          "title": "Photo Url",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "privacyConsent": {
          "title": "Privacy Consent",
          "description": "Required for BR (LGPD) and EU (GDPR) residents.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "object",
          "of": "PrivacyConsent"
        },
        "notes": {
          "title": "Notes",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string",
          "maxLength": 1000
        },
        "general": {
          "title": "Organization fields",
          "description": "Fields the organization promoted because more than one module needed them. Schema in the project registry; a module reads it and does not declare it.",
          "required": false,
          "origin": "nivel1",
          "layer": "document",
          "type": "object",
          "fields": {}
        }
      }
    }
  },
  "relationships": [
    {
      "type": "Owns",
      "as": "from",
      "otherSubtypes": [
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment"
      ],
      "compactKeys": [
        "ownedAssets"
      ]
    },
    {
      "type": "Employs",
      "as": "to",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "employers"
      ]
    },
    {
      "type": "OffersService",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ],
      "compactKeys": [
        "offeredServices"
      ]
    },
    {
      "type": "Teaches",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ],
      "compactKeys": [
        "taughtServices"
      ]
    },
    {
      "type": "ManagedBy",
      "as": "from",
      "otherSubtypes": [
        "Company",
        "Service"
      ],
      "compactKeys": [
        "managedOrganizations"
      ]
    },
    {
      "type": "ReportsTo",
      "as": "both",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "reportManagers",
        "reports"
      ]
    },
    {
      "type": "AssignedTo",
      "as": "from",
      "otherSubtypes": [
        "Company",
        "Service"
      ],
      "compactKeys": [
        "assignments"
      ]
    },
    {
      "type": "Attends",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ],
      "compactKeys": [
        "attendedServices"
      ]
    },
    {
      "type": "PartnersWith",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "partners"
      ]
    },
    {
      "type": "Family",
      "as": "both",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "family"
      ]
    },
    {
      "type": "GuardianOf",
      "as": "both",
      "otherSubtypes": [
        "Person",
        "Animal"
      ],
      "compactKeys": [
        "pets",
        "guardians"
      ]
    },
    {
      "type": "CustomerOf",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "suppliers"
      ]
    },
    {
      "type": "MemberOf",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "memberships"
      ]
    },
    {
      "type": "HoldsAccount",
      "as": "from",
      "otherSubtypes": [
        "BankAccount"
      ],
      "compactKeys": [
        "bankAccounts"
      ]
    },
    {
      "type": "LocatedAt",
      "as": "from",
      "otherSubtypes": [
        "AssetProperty"
      ],
      "compactKeys": [
        "locations"
      ]
    },
    {
      "type": "Signed",
      "as": "from",
      "otherSubtypes": [
        "Document"
      ],
      "compactKeys": [
        "documents"
      ]
    },
    {
      "type": "HasContact",
      "as": "from",
      "otherSubtypes": [
        "ContactChannel"
      ],
      "compactKeys": [
        "contacts"
      ]
    }
  ],
  "capabilities": [
    "locate.byName",
    "locate.byDocument",
    "locate.byContact",
    "locate.byLogin",
    "locate.semantic",
    "locate.byDocumentField",
    "register.createOrAttach",
    "register.asProspect",
    "edit.platformFields",
    "edit.moduleNamespace",
    "inactivate",
    "merge",
    "delete",
    "link",
    "unlink",
    "link.contact",
    "listLinks",
    "attach.document",
    "comment",
    "tag",
    "sequence.next",
    "statusHistory.read",
    "audit",
    "invite.login",
    "export.personalData",
    "anonymize"
  ],
  "rules": [
    "rule-person-ssn-unique-for-us",
    "rule-person-privacy-consent-required-br-eu",
    "rule-foreign-namespace-refused",
    "rule-delete-blocked-by-relationships",
    "rule-document-shape-validated",
    "rule-identity-never-in-namespace"
  ],
  "triggers": {
    "onWrite": {
      "when": "any create or update of the record",
      "then": [
        "version + 1",
        "index row rewritten from the identification fields",
        "searchVector recomputed",
        "audit row",
        "outbox row mirrored to DynamoDB"
      ],
      "enforcedBy": "engine",
      "platform": "ready"
    },
    "onLink": {
      "when": "a relationship is created or ended",
      "then": [
        "relationshipRefs recomputed on both sides",
        "version + 1 when the document changed"
      ],
      "enforcedBy": "engine",
      "platform": "ready"
    },
    "onConsentMissing": {
      "when": "a person resident in BR or the EU is written without a valid consent",
      "then": [
        "status forced to Inactive"
      ],
      "ruleRefs": [
        "rule-person-privacy-consent-required-br-eu"
      ],
      "enforcedBy": "engine",
      "platform": "partial"
    },
    "onPromotion": {
      "when": "a prospect is promoted",
      "then": [
        "dedup by document, or by contactType and value",
        "duplicate becomes PendingMerge and is queued",
        "index row moves, relationships migrate, mdmId is kept"
      ],
      "enforcedBy": "engine",
      "platform": "ready"
    },
    "onStatusChange": {
      "when": "the status of the record changes",
      "then": [
        "status history row"
      ],
      "enforcedBy": "engine",
      "platform": "partial"
    }
  }
} as const satisfies MdmEntityArtifact;

export type MdmEntityPersonType = typeof mdmEntityPerson;

export default mdmEntityPerson;
