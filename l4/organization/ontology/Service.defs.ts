/// <mls fileReference="_102034_/l4/organization/ontology/Service.defs.ts" enhancement="_blank"/>

import type { Ns4Level1EntityArtifact } from '/_102034_/l1/mdm/defs/level1Types.js';

export const level1Service = {
  "schemaVersion": "ns4-level1-v2",
  "subtype": "Service",
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
      "fieldId": "serviceCode",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "serviceKind",
      "type": "'Service' | 'Course' | 'Cohort' | 'Subscription' | 'AppointmentType'",
      "required": false
    },
    {
      "fieldId": "parentServiceId",
      "type": "string | null",
      "required": false
    },
    {
      "fieldId": "serviceType",
      "type": "'Course' | 'Consulting' | 'Maintenance' | 'Appointment' | 'Subscription' | 'Other' | null",
      "required": false
    },
    {
      "fieldId": "durationMinutes",
      "type": "number | null",
      "required": false
    },
    {
      "fieldId": "deliveryMode",
      "type": "'Onsite' | 'Remote' | 'Hybrid' | 'Other' | null",
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
      "type": "OffersService",
      "as": "to",
      "otherSubtypes": [
        "Company",
        "Person"
      ]
    },
    {
      "type": "Teaches",
      "as": "to",
      "otherSubtypes": [
        "Person"
      ]
    },
    {
      "type": "HappensAt",
      "as": "from",
      "otherSubtypes": [
        "Location"
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
      "type": "Attends",
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
    "serviceProviders",
    "instructors",
    "serviceLocations",
    "managers",
    "assignees",
    "attendees",
    "contacts"
  ]
} as const satisfies Ns4Level1EntityArtifact;

export type Level1ServiceType = typeof level1Service;

export default level1Service;
