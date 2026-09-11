/// <mls fileReference="_102034_/l4/organization/ontology/Person.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Person = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Person",
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
      "fieldId": "birthDate",
      "type": "string (ISO date) | null",
      "required": false
    },
    {
      "fieldId": "gender",
      "type": "'Male' | 'Female' | 'NonBinary' | 'NotDisclosed' | null",
      "required": false
    },
    {
      "fieldId": "nationality",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "occupation",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "photoUrl",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "privacyConsent",
      "type": "PrivacyConsent | null",
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
      "as": "from",
      "otherSubtypes": [
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment"
      ]
    },
    {
      "type": "Employs",
      "as": "to",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "OffersService",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ]
    },
    {
      "type": "Teaches",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ]
    },
    {
      "type": "ManagedBy",
      "as": "from",
      "otherSubtypes": [
        "Company",
        "Service"
      ]
    },
    {
      "type": "ReportsTo",
      "as": "both",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "AssignedTo",
      "as": "from",
      "otherSubtypes": [
        "Company",
        "Service"
      ]
    },
    {
      "type": "Attends",
      "as": "from",
      "otherSubtypes": [
        "Service"
      ]
    },
    {
      "type": "PartnersWith",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "Family",
      "as": "both",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "GuardianOf",
      "as": "both",
      "otherSubtypes": [
        "Person",
        "Animal"
      ]
    },
    {
      "type": "CustomerOf",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "MemberOf",
      "as": "from",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "HoldsAccount",
      "as": "from",
      "otherSubtypes": [
        "BankAccount"
      ]
    },
    {
      "type": "LocatedAt",
      "as": "from",
      "otherSubtypes": [
        "AssetProperty"
      ]
    },
    {
      "type": "Signed",
      "as": "from",
      "otherSubtypes": [
        "Document"
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
    "ownedAssets",
    "employers",
    "offeredServices",
    "taughtServices",
    "managedOrganizations",
    "reportManagers",
    "reports",
    "assignments",
    "attendedServices",
    "partners",
    "family",
    "pets",
    "guardians",
    "suppliers",
    "memberships",
    "bankAccounts",
    "locations",
    "documents",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1PersonType = typeof level1Person;

export default level1Person;
