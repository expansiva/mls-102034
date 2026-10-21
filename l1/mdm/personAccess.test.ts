/// <mls fileReference="_102034_/l1/mdm/personAccess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MdmDetailRecord, PrivacyConsentValue } from '/_102034_/l1/mdm/module.js';
import {
  isPersonAccessComplete,
  isProtectedPrivacyCountry,
  isTwoLetterCountry,
  isValidPrivacyConsent,
} from '/_102034_/l1/mdm/personAccess.js';
import {
  applyPatchToDetail,
  isPersonAccessComplete as fromSupportComplete,
  isProtectedPrivacyCountry as fromSupportProtected,
  normalizeCountryCode,
  normalizeDetailInput,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

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

test('mdmSupport reexports the same functions', () => {
  assert.equal(fromSupportComplete, isPersonAccessComplete);
  assert.equal(fromSupportProtected, isProtectedPrivacyCountry);
});

test('access matrix', () => {
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: ' br ', privacyConsent: validConsent }), true);
  for (const code of EU) {
    assert.equal(isProtectedPrivacyCountry(code), true);
    assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: code, privacyConsent: validConsent }), true);
    assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: code }), false);
  }
  assert.equal(isProtectedPrivacyCountry('US'), false);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'US' }), true);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'zz' }), true);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'XX' }), true);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: ' uk ' }), true);
  assert.equal(isPersonAccessComplete({ name: 'Ada', countryCode: 'EU' }), true);
  assert.equal(isTwoLetterCountry('ZZ'), true);
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

const ctx = { clock: { nowIso: () => '2026-01-02T00:00:00.000Z' } } as RequestContext;

function personInput(countryCode: unknown): CreateLike {
  return { subtype: 'Person', name: 'Ada', status: 'Active', countryCode };
}

interface CreateLike {
  subtype: string;
  name: string;
  status: string;
  countryCode?: unknown;
  legalName?: string;
}

function assertCountryError(run: () => void): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.statusCode, 400);
    assert.deepEqual(error.details, { field: 'countryCode' });
    return true;
  });
}

test('normalize, create and patch use the two-letter format', () => {
  assert.equal(normalizeCountryCode(null), 'US');
  assert.equal(normalizeCountryCode('  '), 'US');
  assert.equal(normalizeCountryCode(' br '), 'BR');
  assert.equal(normalizeCountryCode(' zz '), 'ZZ');
  assertCountryError(() => normalizeCountryCode('USA'));

  const created = normalizeDetailInput(personInput(' gb ') as never, ctx, 'p1');
  assert.equal(created.countryCode, 'GB');

  const omitted = normalizeDetailInput(personInput(undefined) as never, ctx, 'p2');
  assert.equal(omitted.countryCode, 'US');

  const formatted = normalizeDetailInput(personInput('zz') as never, ctx, 'p3');
  assert.equal(formatted.countryCode, 'ZZ');
  assertCountryError(() => normalizeDetailInput(personInput('USA') as never, ctx, 'p3b'));
  assertCountryError(() => normalizeDetailInput(personInput(12) as never, ctx, 'p4'));

  const draft = normalizeDetailInput(
    { subtype: 'Company', name: 'Acme', legalName: 'Acme Ltd', status: 'Active', countryCode: '  ' } as never,
    ctx,
    'c1',
    { registrationDraft: true },
  );
  assert.equal(draft.countryCode, '');
  assert.equal(draft.registrationDraft, true);

  const legacy = { ...draft, countryCode: 'ZZ' } as MdmDetailRecord;
  const stillLegacy = applyPatchToDetail(legacy, { name: 'Acme 2' }, ctx);
  assert.equal(legacy.countryCode, 'ZZ');
  assert.equal(stillLegacy.countryCode, 'ZZ');
  assert.equal(stillLegacy.registrationDraft, undefined);

  const promoted = applyPatchToDetail(legacy, { countryCode: 'us' }, ctx);
  assert.equal(promoted.countryCode, 'US');
  assert.equal(promoted.registrationDraft, undefined);

  const activeLegacy = { ...created, countryCode: 'ZZ' } as MdmDetailRecord;
  const renamedLegacy = applyPatchToDetail(activeLegacy, { name: 'Ada 2' }, ctx);
  assert.equal(activeLegacy.countryCode, 'ZZ');
  assert.equal(renamedLegacy.countryCode, 'ZZ');

  const patched = applyPatchToDetail(created, { countryCode: ' br ' }, ctx);
  assert.equal(patched.countryCode, 'BR');
  const preserved = applyPatchToDetail(created, { name: 'Ada 3' }, ctx);
  assert.equal(preserved.countryCode, 'GB');
});
