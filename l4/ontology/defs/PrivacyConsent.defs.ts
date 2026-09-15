/// <mls fileReference="_102034_/l4/ontology/defs/PrivacyConsent.defs.ts" enhancement="_blank"/>

import type { MdmValueTypeArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmValueTypePrivacyConsent = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "valueType",
  "valueTypeId": "PrivacyConsent",
  "title": "Privacy Consent",
  "description": "Privacy / data protection consent record embedded in Person documents. Required when countryCode is BR (LGPD) or an EU member state (GDPR).",
  "fields": {
    "consentedAt": {
      "title": "Consented At",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "timestamp"
    },
    "consentVersion": {
      "title": "Consent Version",
      "description": "Version of the privacy policy accepted.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "channel": {
      "title": "Channel",
      "description": "How consent was obtained.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "revokedAt": {
      "title": "Revoked At",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "timestamp"
    },
    "notes": {
      "title": "Notes",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    }
  }
} as const satisfies MdmValueTypeArtifact;

export type MdmValueTypePrivacyConsentType = typeof mdmValueTypePrivacyConsent;

export default mdmValueTypePrivacyConsent;
