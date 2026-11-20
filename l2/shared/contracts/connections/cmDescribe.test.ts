/// <mls fileReference="_102034_/l2/shared/contracts/connections/cmDescribe.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CmDescribeOutput } from '/_102034_/l2/shared/contracts/connections/cm.js';

// The answers of `cm.describe` are two forms (rt279). The compiler holds them: this file must compile.
test('cm.describe answers the same-version form or the full form, never the one the 102047 sent on 20/11', () => {
  const same: CmDescribeOutput = { version: 'v1', allowed: [] };
  const full: CmDescribeOutput = { version: 'empty', toolsMode: 'all', tools: [], allowed: [] };
  // @ts-expect-error a full answer without `tools` is neither form
  const rejected: CmDescribeOutput = { version: 'v1', toolsMode: 'all', allowed: [] };
  assert.equal(same.version, 'v1');
  assert.equal(full.version, 'empty');
  assert.equal(rejected.version, 'v1');
});
