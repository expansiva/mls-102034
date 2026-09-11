/// <mls fileReference="_102034_/l4/organization/ontology/ContactChannel.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1ContactChannel = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "ContactChannel",
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
      "fieldId": "contactType",
      "type": "'Phone' | 'Email' | 'WhatsApp' | 'Instagram' | 'LinkedIn' | 'X' | 'Other'",
      "required": true
    },
    {
      "fieldId": "value",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "isVerified",
      "type": "boolean",
      "required": true
    },
    {
      "fieldId": "verifiedAt",
      "type": "timestamp | null",
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
      "type": "HasContact",
      "as": "both",
      "otherSubtypes": [
        "Person",
        "Company",
        "Product",
        "Service",
        "Location",
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment",
        "Animal",
        "BankAccount",
        "Document",
        "ContactChannel"
      ]
    }
  ],
  "compactRelationshipKeys": [
    "contacts",
    "contactOwners"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1ContactChannelType = typeof level1ContactChannel;

export default level1ContactChannel;
