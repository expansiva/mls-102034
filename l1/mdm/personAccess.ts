/// <mls fileReference="_102034_/l1/mdm/personAccess.ts" enhancement="_blank" />
import type { PrivacyConsentValue } from '/_102034_/l1/mdm/module.js';

export interface PersonAccessData {
  name?: string | null;
  countryCode?: string | null;
  privacyConsent?: PrivacyConsentValue | null;
}

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE',
]);

export function isTwoLetterCountry(countryCode: string): boolean {
  return /^[A-Z]{2}$/.test(countryCode);
}

export function isValidPrivacyConsent(consent: PrivacyConsentValue | null | undefined): boolean {
  if (!consent || consent.revokedAt) {
    return false;
  }
  if (!String(consent.consentVersion ?? '').trim() || !String(consent.channel ?? '').trim()) {
    return false;
  }
  return Number.isFinite(Date.parse(consent.consentedAt));
}

/** Name, country and, in a protected country, a valid consent. Ignores registrationDraft. */
export function isPersonAccessComplete(detail: PersonAccessData): boolean {
  const countryCode = typeof detail.countryCode === 'string' ? detail.countryCode.trim().toUpperCase() : '';
  if (!detail.name?.trim() || !isTwoLetterCountry(countryCode)) {
    return false;
  }
  if (isProtectedPrivacyCountry(countryCode) && !isValidPrivacyConsent(detail.privacyConsent)) {
    return false;
  }
  return true;
}

/** Expects an already normalized ISO code (BR / EU). */
export function isProtectedPrivacyCountry(countryCode: string): boolean {
  return countryCode === 'BR' || EU_COUNTRY_CODES.has(countryCode);
}
