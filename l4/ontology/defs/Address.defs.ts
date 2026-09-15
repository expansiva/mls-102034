/// <mls fileReference="_102034_/l4/ontology/defs/Address.defs.ts" enhancement="_blank"/>

import type { MdmValueTypeArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmValueTypeAddress = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "valueType",
  "valueTypeId": "Address",
  "title": "Address",
  "description": "A physical or mailing address. Embedded inline in entity documents — not a standalone MDM entity.",
  "fields": {
    "type": {
      "title": "Type",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "enum",
      "values": [
        {
          "value": "Residential",
          "title": "Residential"
        },
        {
          "value": "Commercial",
          "title": "Commercial"
        },
        {
          "value": "Billing",
          "title": "Billing"
        },
        {
          "value": "Delivery",
          "title": "Delivery"
        },
        {
          "value": "Other",
          "title": "Other"
        }
      ]
    },
    "label": {
      "title": "Label",
      "description": "Short human label for this address.",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string",
      "maxLength": 60
    },
    "line1": {
      "title": "Line1",
      "description": "Primary address line: street and number, PO Box, or rural route.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "line2": {
      "title": "Line2",
      "description": "Secondary line: apartment, suite, floor, unit, building.",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "line3": {
      "title": "Line3",
      "description": "Tertiary line: neighborhood, district, borough, ward. Required in some countries (Brazil, India, Japan).",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "city": {
      "title": "City",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "stateOrProvince": {
      "title": "State Or Province",
      "description": "State, province, prefecture, or canton. For US use 2-letter code (CA, NY, TX).",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "postalCode": {
      "title": "Postal Code",
      "description": "ZIP, postcode, CEP, PIN — format varies by country. MDM does not enforce format.",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "countryCode": {
      "title": "Country Code",
      "description": "ISO 3166-1 alpha-2. Drives address format display in UI.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "formatted": {
      "title": "Formatted",
      "description": "Cached full address string as it would appear on an envelope. Async-generated. Avoids per-country format reconstruction at render time.",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "string"
    },
    "geolocation": {
      "title": "Geolocation",
      "required": false,
      "nullable": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "object",
      "of": "GeoPoint"
    },
    "isPrimary": {
      "title": "Is Primary",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "boolean"
    }
  }
} as const satisfies MdmValueTypeArtifact;

export type MdmValueTypeAddressType = typeof mdmValueTypeAddress;

export default mdmValueTypeAddress;
