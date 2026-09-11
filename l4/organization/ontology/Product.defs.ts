/// <mls fileReference="_102034_/l4/organization/ontology/Product.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Product = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Product",
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
      "fieldId": "sku",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "productType",
      "type": "'Physical' | 'Digital' | 'Bundle' | 'Consumable' | 'Other' | null",
      "required": false
    },
    {
      "fieldId": "category",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "brand",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "unitOfMeasure",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "isInventoried",
      "type": "boolean",
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
      "type": "OffersProduct",
      "as": "to",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "StocksAt",
      "as": "from",
      "otherSubtypes": [
        "Location"
      ]
    },
    {
      "type": "SuppliesProduct",
      "as": "to",
      "otherSubtypes": [
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
    "productSuppliers",
    "stockLocations",
    "productVendors",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1ProductType = typeof level1Product;

export default level1Product;
