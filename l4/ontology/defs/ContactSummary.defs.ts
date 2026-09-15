/// <mls fileReference="_102034_/l4/ontology/defs/ContactSummary.defs.ts" enhancement="_blank"/>

import type { MdmValueTypeArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmValueTypeContactSummary = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "valueType",
  "valueTypeId": "ContactSummary",
  "title": "Contact Summary",
  "description": "Slim reference to a ContactChannel entity. Embedded in the detail of any entity that has associated contacts.",
  "fields": {
    "mdmId": {
      "title": "Mdm Id",
      "description": "mdmId of the ContactChannel entity. Required for traceability and cross-module linking.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "uuid"
    },
    "title": {
      "title": "Title",
      "description": "Human-readable label for this contact in the context of the parent entity.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string",
      "maxLength": 60
    }
  }
} as const satisfies MdmValueTypeArtifact;

export type MdmValueTypeContactSummaryType = typeof mdmValueTypeContactSummary;

export default mdmValueTypeContactSummary;
