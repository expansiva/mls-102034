/// <mls fileReference="_102034_/l4/organization/ontology/index.defs.ts" enhancement="_blank"/>

import type { Ns4Level1IndexArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const organizationLevel1Index = {
  "schemaVersion": "ns4-level1-v2",
  "level1SchemaVersion": "ns4-level1-v2",
  "subtypes": [
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
  ],
  "docTypes": [
    "SSN",
    "EIN",
    "Passport",
    "DriversLicense",
    "NationalId",
    "CPF",
    "CNPJ",
    "VAT",
    "Other"
  ],
  "mdmStatuses": [
    "Active",
    "Inactive",
    "Merged",
    "Blocked"
  ],
  "relationshipTypes": [
    {
      "type": "Owns",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "AssetGeneric",
        "AssetVehicle",
        "AssetProperty",
        "AssetEquipment"
      ],
      "bidirectional": false
    },
    {
      "type": "Employs",
      "from": [
        "Company"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": false
    },
    {
      "type": "OffersProduct",
      "from": [
        "Company"
      ],
      "to": [
        "Product"
      ],
      "bidirectional": false
    },
    {
      "type": "OffersService",
      "from": [
        "Company",
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false
    },
    {
      "type": "StocksAt",
      "from": [
        "Product",
        "AssetEquipment"
      ],
      "to": [
        "Location"
      ],
      "bidirectional": false
    },
    {
      "type": "Teaches",
      "from": [
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false
    },
    {
      "type": "HappensAt",
      "from": [
        "Service"
      ],
      "to": [
        "Location"
      ],
      "bidirectional": false
    },
    {
      "type": "FranchiseOf",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "BelongsToGroup",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "PartOfUnit",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "ManagedBy",
      "from": [
        "Person"
      ],
      "to": [
        "Company",
        "Service"
      ],
      "bidirectional": false
    },
    {
      "type": "ReportsTo",
      "from": [
        "Person"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": false
    },
    {
      "type": "AssignedTo",
      "from": [
        "Person"
      ],
      "to": [
        "Company",
        "Service"
      ],
      "bidirectional": false
    },
    {
      "type": "Attends",
      "from": [
        "Person"
      ],
      "to": [
        "Service"
      ],
      "bidirectional": false
    },
    {
      "type": "SuppliesProduct",
      "from": [
        "Company"
      ],
      "to": [
        "Product"
      ],
      "bidirectional": false
    },
    {
      "type": "PartnersWith",
      "from": [
        "Person"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "Family",
      "from": [
        "Person"
      ],
      "to": [
        "Person"
      ],
      "bidirectional": true
    },
    {
      "type": "GuardianOf",
      "from": [
        "Person"
      ],
      "to": [
        "Person",
        "Animal"
      ],
      "bidirectional": false
    },
    {
      "type": "CustomerOf",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "SupplierOf",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "MemberOf",
      "from": [
        "Person"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "HoldsAccount",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "BankAccount"
      ],
      "bidirectional": false
    },
    {
      "type": "SubsidiaryOf",
      "from": [
        "Company"
      ],
      "to": [
        "Company"
      ],
      "bidirectional": false
    },
    {
      "type": "LocatedAt",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "AssetProperty"
      ],
      "bidirectional": false
    },
    {
      "type": "Signed",
      "from": [
        "Person",
        "Company"
      ],
      "to": [
        "Document"
      ],
      "bidirectional": false
    },
    {
      "type": "HasContact",
      "from": [
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
      ],
      "to": [
        "ContactChannel"
      ],
      "bidirectional": false
    }
  ]
} as const satisfies Ns4Level1IndexArtifact;

export type OrganizationLevel1IndexType = typeof organizationLevel1Index;

export default organizationLevel1Index;
