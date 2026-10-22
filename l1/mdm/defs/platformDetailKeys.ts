/// <mls fileReference="_102034_/l1/mdm/defs/platformDetailKeys.ts" enhancement="_blank" />

/**
 * Runtime classification of MDM `details` keys: platform catalog fields vs engine
 * compatibility extras vs computed. Consumers share this module; they do not keep
 * a mirrored Set. Classification does not grant write access to derived fields.
 */

/** Names declared by the platform catalog (identification, base, and subtypes). */
export const MDM_CATALOG_PLATFORM_DETAIL_KEYS = [
  'subtype', 'name', 'status', 'moduleTypes', 'docType', 'docId',
  'countryCode', 'tags', 'aliases', 'contacts', 'relationshipRefs', 'addresses',
  'mergedInto', 'createdAt', 'updatedAt',
  'privacyConsent', 'birthDate', 'gender', 'nationality', 'occupation', 'photoUrl', 'notes',
  'companyKind', 'parentCompanyId', 'externalCode', 'legalName', 'tradeName', 'legalType',
  'foundingDate', 'taxRegime', 'industryCode', 'website',
  'sku', 'productType', 'category', 'brand', 'unitOfMeasure', 'isInventoried',
  'serviceCode', 'serviceKind', 'parentServiceId', 'serviceType', 'durationMinutes', 'deliveryMode',
  'locationType', 'locationCode', 'parentLocationId', 'capacity', 'propertyAddress',
  'assetCategory', 'serialNumber', 'manufacturer', 'model',
  'contactType', 'value', 'isVerified', 'verifiedAt',
  'storageBucket', 'storagePath', 'originModule', 'docCategory', 'fileName', 'mimeType',
  'bankRoutingNumber', 'bankName', 'accountNumber', 'accountType', 'swift', 'iban',
  'pixKey', 'pixKeyType',
  'acquisitionDate', 'areaM2', 'areaSqft', 'breed', 'color', 'expiresAt', 'fileSizeKb',
  'fuelType', 'isNeutered', 'issuedAt', 'issuer', 'microchip', 'plate', 'propertyType',
  'registrationNumber', 'sex', 'species', 'taxParcelId', 'vin', 'year',
] as const;

/**
 * Engine/prospect extras accepted by the current contract. Not catalog fields and
 * not module namespaces. Exported for the parity test; do not copy these strings.
 */
export const MDM_ENGINE_COMPAT_DETAIL_KEYS = [
  'mdmId',
  'registrationDraft',
  'promotionSource',
  'promotedTo',
  'ttlExpiresAt',
] as const;

/** Computed on facade reads; never a persisted module namespace. */
export const MDM_COMPUTED_DETAIL_KEYS: ReadonlySet<string> = new Set(['namespaces']);

export const MDM_PLATFORM_DETAIL_KEYS: ReadonlySet<string> = new Set<string>([
  ...MDM_CATALOG_PLATFORM_DETAIL_KEYS,
  ...MDM_ENGINE_COMPAT_DETAIL_KEYS,
]);

export function isMdmComputedDetailKey(key: string): boolean {
  return MDM_COMPUTED_DETAIL_KEYS.has(key);
}

export function isMdmPlatformDetailKey(key: string): boolean {
  return MDM_PLATFORM_DETAIL_KEYS.has(key);
}
