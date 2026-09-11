/// <mls fileReference="_102034_/l4/organization/ontology/Location.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Location = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Location",
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
      "fieldId": "locationType",
      "type": "'Room' | 'Warehouse' | 'Building' | 'Campus' | 'Store' | 'Office' | 'Shelf' | 'Other'",
      "required": true
    },
    {
      "fieldId": "locationCode",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "parentLocationId",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "capacity",
      "type": "number | null",
      "required": false
    },
    {
      "fieldId": "propertyAddress",
      "type": "Address | null",
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
      "type": "StocksAt",
      "as": "to",
      "otherSubtypes": [
        "Product",
        "AssetEquipment"
      ]
    },
    {
      "type": "HappensAt",
      "as": "to",
      "otherSubtypes": [
        "Service"
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
    "stockedItems",
    "scheduledServices",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1LocationType = typeof level1Location;

export default level1Location;
