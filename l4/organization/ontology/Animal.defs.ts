/// <mls fileReference="_102034_/l4/organization/ontology/Animal.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Animal = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Animal",
  "identification": [
    {
      "fieldId": "name",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "docType",
      "type": "DocType | null",
      "required": false
    },
    {
      "fieldId": "docId",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "countryCode",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "tags",
      "type": "string[]",
      "required": true
    }
  ],
  "baseFields": [
    {
      "fieldId": "aliases",
      "type": "string[]",
      "required": true
    },
    {
      "fieldId": "contacts",
      "type": "ContactSummaryValue[]",
      "required": true
    },
    {
      "fieldId": "addresses",
      "type": "AddressValue[]",
      "required": true
    },
    {
      "fieldId": "relationshipRefs",
      "type": "CompactRelationshipRefs",
      "required": true
    },
    {
      "fieldId": "species",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "breed",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "birthDate",
      "type": "string (ISO date) | null",
      "required": false
    },
    {
      "fieldId": "sex",
      "type": "'Male' | 'Female' | 'Unknown' | null",
      "required": false
    },
    {
      "fieldId": "color",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "microchip",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "registrationNumber",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "isNeutered",
      "type": "boolean | null",
      "required": false
    },
    {
      "fieldId": "notes",
      "type": "string | null",
      "required": false
    }
  ],
  "allowedRelationships": [
    {
      "type": "GuardianOf",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "HasContact",
      "as": "from",
      "otherSubtypes": [
        "ContactChannel"
      ]
    }
  ],
  "compactRelationshipKeys": [
    "guardians",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1AnimalType = typeof level1Animal;

export default level1Animal;
