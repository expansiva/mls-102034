/// <mls fileReference="_102034_/l1/mdm/countryCatalog.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { countryCodes, isSupportedCountryCode } from '/_102034_/l1/mdm/countryCodes.js';
import { getCountryCatalog } from '/_102034_/l1/mdm/countryCatalog.js';
import { isProtectedPrivacyCountry } from '/_102034_/l1/mdm/personAccess.js';

test('assigned country codes', () => {
  const codes = countryCodes.map((entry) => entry.code);
  assert.equal(codes.length, 249);
  assert.equal(new Set(codes).size, 249);
  assert.deepEqual(codes, [...codes].sort());
  for (const code of ['AD', 'BR', 'GB', 'US', 'ZW']) {
    assert.equal(isSupportedCountryCode(code), true);
  }
  for (const code of ['ZZ', 'XK', 'EU', 'UK', 'br', ' BR ', 'US ', 'USA']) {
    assert.equal(isSupportedCountryCode(code), false);
  }
  assert.equal(countryCodes.every((entry) => entry.englishName.trim().length > 0), true);
});

test('catalog names, consent flag and isolation', () => {
  const english = getCountryCatalog();
  const englishExplicit = getCountryCatalog('en');
  assert.equal(english.length, 249);
  assert.deepEqual(english.map((item) => item.code), countryCodes.map((entry) => entry.code));
  assert.equal(english.every((item) => item.name.trim().length > 0), true);
  for (const item of english) {
    assert.equal(item.requiresPrivacyConsent, isProtectedPrivacyCountry(item.code));
  }
  assert.equal(english.find((item) => item.code === 'BR')?.name, 'Brazil');

  const portuguese = getCountryCatalog('pt-BR');
  assert.equal(portuguese.every((item) => item.name.trim().length > 0), true);
  const brazil = portuguese.find((item) => item.code === 'BR');
  assert.ok(brazil);
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    assert.equal(brazil.name, 'Brasil');
  } else {
    assert.equal(brazil.name, 'Brazil');
  }

  const invalid = getCountryCatalog('not a locale');
  assert.equal(invalid.find((item) => item.code === 'BR')?.name, englishExplicit.find((item) => item.code === 'BR')?.name);

  // Frozen in any mode: sloppy-mode assignment is ignored, strict mode throws. Assert the state, not the throw.
  const snapshot = english[0].name;
  assert.equal(Object.isFrozen(english), true);
  assert.equal(Object.isFrozen(english[0]), true);
  try {
    (english[0] as { name: string }).name = 'hacked';
  } catch {
    // strict mode
  }
  try {
    (english as unknown as { push: (value: unknown) => void }).push({ code: 'ZZ' });
  } catch {
    // frozen array refuses push in every mode
  }
  assert.equal(getCountryCatalog('en')[0].name, snapshot);
  assert.equal(getCountryCatalog('en').some((item) => item.code === 'ZZ'), false);
});
