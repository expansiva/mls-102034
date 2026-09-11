/// <mls fileReference="_102034_/l4/organization/ontology/Company.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Company = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Company",
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
      "fieldId": "companyKind",
      "type": "'LegalEntity' | 'Branch' | 'Franchise' | 'BusinessUnit' | 'Group' | 'Team' | 'Department' | 'InternalOrg'",
      "required": true
    },
    {
      "fieldId": "parentCompanyId",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "externalCode",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "tradeName",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "legalName",
      "type": "string",
      "required": true
    },
    {
      "fieldId": "legalType",
      "type": "'Corporation' | 'LLC' | 'SoleProp' | 'Partnership' | 'Nonprofit' | 'Government' | 'Other' | null",
      "required": false
    },
    {
      "fieldId": "foundingDate",
      "type": "string (ISO date) | null",
      "required": false
    },
    {
      "fieldId": "taxRegime",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "industryCode",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "website",
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
      "as": "from",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "OffersProduct",
      "as": "from",
      "otherSubtypes": [
        "Product"
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
      "type": "FranchiseOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "BelongsToGroup",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "PartOfUnit",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "ManagedBy",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "AssignedTo",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "SuppliesProduct",
      "as": "from",
      "otherSubtypes": [
        "Product"
      ]
    },
    {
      "type": "PartnersWith",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "CustomerOf",
      "as": "both",
      "otherSubtypes": [
        "Person",
        "Company"
      ]
    },
    {
      "type": "SupplierOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
      ]
    },
    {
      "type": "MemberOf",
      "as": "to",
      "otherSubtypes": [
        "Person"
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
      "type": "SubsidiaryOf",
      "as": "both",
      "otherSubtypes": [
        "Company"
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
    "employees",
    "offeredProducts",
    "offeredServices",
    "franchisors",
    "franchisees",
    "groupParents",
    "groupMembers",
    "unitParents",
    "unitChildren",
    "managers",
    "assignees",
    "suppliedProducts",
    "partners",
    "suppliers",
    "customers",
    "members",
    "bankAccounts",
    "parentCompanies",
    "subsidiaries",
    "locations",
    "documents",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1CompanyType = typeof level1Company;

export default level1Company;
