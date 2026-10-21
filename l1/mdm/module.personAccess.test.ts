/// <mls fileReference="_102034_/l1/mdm/module.personAccess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCountryCatalog,
  isPersonAccessComplete,
  isProtectedPrivacyCountry,
  isValidPrivacyConsent,
  moduleConfig,
  type MdmCountryOption,
  type PrivacyConsentValue,
} from '/_102034_/l1/mdm/module.js';
import { getCountryCatalog as fromCatalog } from '/_102034_/l1/mdm/countryCatalog.js';
import {
  isPersonAccessComplete as fromPureComplete,
  isProtectedPrivacyCountry as fromPureProtected,
  isValidPrivacyConsent as fromPureValid,
} from '/_102034_/l1/mdm/personAccess.js';
import {
  isPersonAccessComplete as fromSupportComplete,
  isProtectedPrivacyCountry as fromSupportProtected,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';

const EU = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE',
] as const;

const validConsent: PrivacyConsentValue = {
  consentedAt: '2026-01-02T00:00:00.000Z',
  consentVersion: 'v1',
  channel: 'web',
};

test('public module reexports the same person-access functions', () => {
  assert.equal(moduleConfig.moduleId, 'mdm');
  assert.equal(isPersonAccessComplete, fromPureComplete);
  assert.equal(isPersonAccessComplete, fromSupportComplete);
  assert.equal(isProtectedPrivacyCountry, fromPureProtected);
  assert.equal(isProtectedPrivacyCountry, fromSupportProtected);
  assert.equal(isValidPrivacyConsent, fromPureValid);
  assert.equal(getCountryCatalog, fromCatalog);
  const option: MdmCountryOption = getCountryCatalog().find((item) => item.code === 'BR')!;
  assert.equal(option.code, 'BR');
  assert.equal(option.requiresPrivacyConsent, true);
});

test('public person-access matrix', () => {
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: ' br ', privacyConsent: validConsent }), true);
  for (const code of EU) {
    assert.equal(isProtectedPrivacyCountry(code), true);
    assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: code, privacyConsent: validConsent }), true);
    assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: code }), false);
  }
  assert.equal(isProtectedPrivacyCountry('US'), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'US' }), true);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'zz' }), false);
  assert.equal(isPersonAccessComplete({ name: '  ', countryCode: 'US' }), false);
  assert.equal(isPersonAccessComplete({ countryCode: 'US' }), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada' }), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'USA' }), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'B' }), false);

  const legacy = { accepted: true, acceptedAt: '2026-01-02', policy: 'old' } as unknown as PrivacyConsentValue;
  assert.equal(isValidPrivacyConsent(legacy), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'BR', privacyConsent: legacy }), false);
  assert.equal(isValidPrivacyConsent({ ...validConsent, consentedAt: 'nope' }), false);
  assert.equal(isValidPrivacyConsent({ ...validConsent, consentVersion: '  ' }), false);
  assert.equal(isValidPrivacyConsent({ ...validConsent, channel: '' }), false);
  assert.equal(isValidPrivacyConsent({ ...validConsent, revokedAt: '2026-02-01T00:00:00.000Z' }), false);
  assert.equal(isValidPrivacyConsent(validConsent), true);
  assert.equal(isValidPrivacyConsent(null), false);
});
