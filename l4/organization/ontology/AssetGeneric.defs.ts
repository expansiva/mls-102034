/// <mls fileReference="_102034_/l4/organization/ontology/AssetGeneric.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1AssetGeneric = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "AssetGeneric",
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
      "fieldId": "assetCategory",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "serialNumber",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "manufacturer",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "model",
      "type": "string | null",
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
      "type": "Owns",
      "as": "to",
      "otherSubtypes": [
        "Person",
        "Company"
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
    "owners",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1AssetGenericType = typeof level1AssetGeneric;

export default level1AssetGeneric;
