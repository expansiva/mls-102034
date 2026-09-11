/// <mls fileReference="_102034_/l4/organization/ontology/Document.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Document = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Document",
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
      "fieldId": "originModule",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "docCategory",
      "type": "'Contract' | 'Certificate' | 'IdDocument' | 'Invoice' | 'Receipt' | 'Report' | 'Photo' | 'Other'",
      "required": true
    },
    {
      "fieldId": "storageBucket",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "storagePath",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "fileName",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "mimeType",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "fileSizeKb",
      "type": "number | null",
      "required": false
    },
    {
      "fieldId": "issuedAt",
      "type": "string (ISO date) | null",
      "required": false
    },
    {
      "fieldId": "expiresAt",
      "type": "string (ISO date) | null",
      "required": false
    },
    {
      "fieldId": "issuer",
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
      "type": "Signed",
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
    "signedBy",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1DocumentType = typeof level1Document;

export default level1Document;
