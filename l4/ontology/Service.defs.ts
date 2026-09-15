/// <mls fileReference="_102034_/l4/ontology/Service.defs.ts" enhancement="_blank"/>

import type { MdmEntityArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmEntityService = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "entity",
  "entityId": "Service",
  "title": "Service",
  "description": "Subtype Service — reusable service or offering that may be sold, scheduled, taught, or assigned to a location. Also covers course-like offerings.",
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
              "value": "Service",
              "title": "Service"
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
            "attendees": {
              "title": "Attendees",
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
            "instructors": {
              "title": "Instructors",
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
            "serviceLocations": {
              "title": "Service Locations",
              "description": "Ids of the linked records. Derived by the engine from the active relationships.",
              "required": false,
              "collection": true,
              "origin": "derived",
              "layer": "document",
              "type": "record",
              "to": [
                "Location"
              ]
            },
            "serviceProviders": {
              "title": "Service Providers",
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
            }
          }
        },
        "serviceCode": {
          "title": "Service Code",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "serviceKind": {
          "title": "Service Kind",
          "description": "Use Cohort for a concrete class/offering instance.",
          "required": false,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "Service",
              "title": "Service"
            },
            {
              "value": "Course",
              "title": "Course"
            },
            {
              "value": "Cohort",
              "title": "Cohort"
            },
            {
              "value": "Subscription",
              "title": "Subscription"
            },
            {
              "value": "AppointmentType",
              "title": "AppointmentType"
            }
          ]
        },
        "parentServiceId": {
          "title": "Parent Service Id",
          "description": "Parent mdmId when this service is a cohort or derived offering from a base service.",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "string"
        },
        "serviceType": {
          "title": "Service Type",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "Course",
              "title": "Course"
            },
            {
              "value": "Consulting",
              "title": "Consulting"
            },
            {
              "value": "Maintenance",
              "title": "Maintenance"
            },
            {
              "value": "Appointment",
              "title": "Appointment"
            },
            {
              "value": "Subscription",
              "title": "Subscription"
            },
            {
              "value": "Other",
              "title": "Other"
            }
          ]
        },
        "durationMinutes": {
          "title": "Duration Minutes",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "number"
        },
        "deliveryMode": {
          "title": "Delivery Mode",
          "required": false,
          "nullable": true,
          "origin": "nivel1",
          "layer": "document",
          "type": "enum",
          "values": [
            {
              "value": "Onsite",
              "title": "Onsite"
            },
            {
              "value": "Remote",
              "title": "Remote"
            },
            {
              "value": "Hybrid",
              "title": "Hybrid"
            },
            {
              "value": "Other",
              "title": "Other"
            }
          ]
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
      "type": "OffersService",
      "as": "to",
      "otherSubtypes": [
        "Company",
        "Person"
      ],
      "compactKeys": [
        "serviceProviders"
      ]
    },
    {
      "type": "Teaches",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "instructors"
      ]
    },
    {
      "type": "HappensAt",
      "as": "from",
      "otherSubtypes": [
        "Location"
      ],
      "compactKeys": [
        "serviceLocations"
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
      "type": "Attends",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ],
      "compactKeys": [
        "attendees"
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

export type MdmEntityServiceType = typeof mdmEntityService;

export default mdmEntityService;
