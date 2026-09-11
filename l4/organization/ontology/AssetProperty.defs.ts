/// <mls fileReference="_102034_/l4/organization/ontology/AssetProperty.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1AssetProperty = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "AssetProperty",
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
      "fieldId": "registrationNumber",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "propertyAddress",
      "type": "Address | null",
      "required": false
    },
    {
      "fieldId": "areaSqft",
      "type": "number | null",
      "required": false
    },
    {
      "fieldId": "areaM2",
      "type": "number | null",
      "required": false
    },
    {
      "fieldId": "propertyType",
      "type": "'Residential' | 'Commercial' | 'Rural' | 'UrbanLot' | 'Industrial' | 'Other' | null",
      "required": false
    },
    {
      "fieldId": "taxParcelId",
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
      "type": "LocatedAt",
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
    "locatedEntities",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1AssetPropertyType = typeof level1AssetProperty;

export default level1AssetProperty;
