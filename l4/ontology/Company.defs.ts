/// <mls fileReference="_102034_/l4/ontology/Company.defs.ts" enhancement="_blank"/>

import type { MdmEntityArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmEntityCompany = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "entity",
  "entityId": "Company",
  "title": "Company",
  "description": "Subtype Company — corporations, LLCs, nonprofits, government entities.",
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
              "value": "Company",
              "title": "Company"
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
            "assignees": {
              "title": "Assignees",
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
            "customers": {
              "title": "Customers",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Person",
                "Company"
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
            "employees": {
              "title": "Employees",
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
            "franchisees": {
              "title": "Franchisees",
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
            "franchisors": {
              "title": "Franchisors",
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
            "groupMembers": {
              "title": "Group Members",
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
            "groupParents": {
              "title": "Group Parents",
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
            "managers": {
              "title": "Managers",
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
            "members": {
              "title": "Members",
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
            "offeredProducts": {
              "title": "Offered Products",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Product"
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
            "parentCompanies": {
              "title": "Parent Companies",
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
            "subsidiaries": {
              "title": "Subsidiaries",
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
            "suppliedProducts": {
              "title": "Supplied Products",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Product"
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
            "unitChildren": {
              "title": "Unit Children",
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
            "unitParents": {
              "title": "Unit Parents",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Company"
              ]
            }
          }
        },
        "companyKind": {
          "title": "Company Kind",
          "description": "Organizational classification for legal and internal structures.",
          "required": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "LegalEntity",
              "title": "LegalEntity"
            },
            {
              "value": "Branch",
              "title": "Branch"
            },
            {
              "value": "Franchise",
              "title": "Franchise"
            },
            {
              "value": "BusinessUnit",
              "title": "BusinessUnit"
            },
            {
              "value": "Group",
              "title": "Group"
            },
            {
              "value": "Team",
              "title": "Team"
            },
            {
              "value": "Department",
              "title": "Department"
            },
            {
              "value": "InternalOrg",
              "title": "InternalOrg"
            }
          ]
        },
        "parentCompanyId": {
          "title": "Parent Company Id",
          "description": "Optional parent mdmId for organizational trees.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "externalCode": {
          "title": "External Code",
          "description": "ERP/HR/legacy code used by consuming modules.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "tradeName": {
          "title": "Trade Name",
          "description": "DBA name. Also stored in aliases for full-text search.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "legalName": {
          "title": "Legal Name",
          "description": "Official registered name.",
          "required": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "legalType": {
          "title": "Legal Type",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "Corporation",
              "title": "Corporation"
            },
            {
              "value": "LLC",
              "title": "LLC"
            },
            {
              "value": "SoleProp",
              "title": "SoleProp"
            },
            {
              "value": "Partnership",
              "title": "Partnership"
            },
            {
              "value": "Nonprofit",
              "title": "Nonprofit"
            },
            {
              "value": "Government",
              "title": "Government"
            },
            {
              "value": "Other",
              "title": "Other"
            }
          ]
        },
        "foundingDate": {
          "title": "Founding Date",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "date"
        },
        "taxRegime": {
          "title": "Tax Regime",
          "description": "Country-specific tax class. Examples: S-Corp, C-Corp (US); Simples Nacional (BR).",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "industryCode": {
          "title": "Industry Code",
          "description": "NAICS code (US), CNAE (BR), or equivalent.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "website": {
          "title": "Website",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
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
      "as": "from",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "employees"
      ]
    },
    {
      "type": "OffersProduct",
      "as": "from",
      "otherSubtypes": [
        "Product"
      ],
      "compactKeys": [
        "offeredProducts"
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
      "type": "FranchiseOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "franchisors",
        "franchisees"
      ]
    },
    {
      "type": "BelongsToGroup",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "groupParents",
        "groupMembers"
      ]
    },
    {
      "type": "PartOfUnit",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "unitParents",
        "unitChildren"
      ]
    },
    {
      "type": "ManagedBy",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "managers"
      ]
    },
    {
      "type": "AssignedTo",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "assignees"
      ]
    },
    {
      "type": "SuppliesProduct",
      "as": "from",
      "otherSubtypes": [
        "Product"
      ],
      "compactKeys": [
        "suppliedProducts"
      ]
    },
    {
      "type": "PartnersWith",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "partners"
      ]
    },
    {
      "type": "CustomerOf",
      "as": "both",
      "otherSubtypes": [
        "Person",
        "Company"
      ],
      "compactKeys": [
        "suppliers",
        "customers"
      ]
    },
    {
      "type": "SupplierOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "customers",
        "suppliers"
      ]
    },
    {
      "type": "MemberOf",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "members"
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
      "type": "SubsidiaryOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ],
      "compactKeys": [
        "parentCompanies",
        "subsidiaries"
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
    "audit"
  ],
  "rules": [
    "rule-company-ein-unique-for-us",
    "rule-company-legal-name-required",
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

export type MdmEntityCompanyType = typeof mdmEntityCompany;

export default mdmEntityCompany;
