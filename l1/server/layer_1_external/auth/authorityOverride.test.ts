/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/authorityOverride.test.ts" enhancement="_blank" />

// Acting as another authority is the one feature that can make a user look like someone else, so what is
// pinned here is the fence around it: the modes that allow it, and the fact that the real identity never
// disappears from the answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import {
  effectiveAuthorities, readAuthorityOverride, refuseOverride, writeAuthorityOverride,
} from '/_102034_/l1/server/layer_1_external/auth/authorityOverride.js';

test('only development and presentation allow an override', () => {
  assert.equal(refuseOverride('development'), '');
  assert.equal(refuseOverride('presentation'), '');
  assert.match(refuseOverride('production'), /does not allow acting as another authority/u);
  assert.match(refuseOverride('homologation'), /development and presentation only/u);
});

test('the override is stored per user, survives a read, and an empty list clears it', async () => {
  const ctx = createRequestContext();
  assert.equal(await readAuthorityOverride(ctx, 'user-1'), null);

  const set = await writeAuthorityOverride(ctx, 'presentation', 'user-1', ['petShop:admin', 'petShop:admin', ' ']);
  assert.deepEqual(set?.authorities, ['petShop:admin'], 'deduped and trimmed');
  const read = await readAuthorityOverride(ctx, 'user-1');
  assert.deepEqual(read?.authorities, ['petShop:admin']);
  assert.equal(read?.userId, 'user-1');

  // Another user is untouched by it.
  assert.equal(await readAuthorityOverride(ctx, 'user-2'), null);

  assert.equal(await writeAuthorityOverride(ctx, 'presentation', 'user-1', []), null);
  assert.equal(await readAuthorityOverride(ctx, 'user-1'), null);
});

test('production refuses the write, and an anonymous caller cannot set one', async () => {
  const ctx = createRequestContext();
  await assert.rejects(() => writeAuthorityOverride(ctx, 'production', 'user-1', ['petShop:admin']), /does not allow/u);
  await assert.rejects(() => writeAuthorityOverride(ctx, 'presentation', '', ['petShop:admin']), /authenticated user/u);
});

test('what the session acts with never hides what the user really has', () => {
  const real = ['petShop:groomer'];
  assert.deepEqual(effectiveAuthorities(real, null), { authorities: ['petShop:groomer'], overridden: false, real: ['petShop:groomer'] });
  assert.deepEqual(
    effectiveAuthorities(real, { userId: 'u', authorities: ['petShop:admin'], setAt: 'now' }),
    { authorities: ['petShop:admin'], overridden: true, real: ['petShop:groomer'] },
  );
  // An override with an empty list is not an override.
  assert.deepEqual(effectiveAuthorities(real, { userId: 'u', authorities: [], setAt: 'now' }).overridden, false);
});
