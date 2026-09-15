/// <mls fileReference="_102034_/l4/ontology/defs/GeoPoint.defs.ts" enhancement="_blank"/>

import type { MdmValueTypeArtifact } from '/_102034_/l1/mdm/defs/ontologyTypes.js';

export const mdmValueTypeGeoPoint = {
  "schemaVersion": "2026-09-15-mdm-ontology-v1",
  "kind": "valueType",
  "valueTypeId": "GeoPoint",
  "title": "Geo Point",
  "description": "A pair of geographic coordinates, embedded in an address.",
  "fields": {
    "lat": {
      "title": "Lat",
      "description": "Latitude in decimal degrees.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "number"
    },
    "lng": {
      "title": "Lng",
      "description": "Longitude in decimal degrees.",
      "required": true,
      "origin": "nivel1",
      "layer": "document",
      "type": "number"
    }
  }
} as const satisfies MdmValueTypeArtifact;

export type MdmValueTypeGeoPointType = typeof mdmValueTypeGeoPoint;

export default mdmValueTypeGeoPoint;
