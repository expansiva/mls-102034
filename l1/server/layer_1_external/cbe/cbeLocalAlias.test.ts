/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLocalAlias.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { localAliasCandidates } from '/_102034_/l1/server/layer_1_external/cbe/cbeLocalAlias.js';

test('plugin miss without extension: l2 then l4, query ignored', () => {
  assert.deepEqual(
    localAliasCandidates('/local/_102020_pluginCollabCoreIndex?cacheBust=1760000000000'),
    ['/_102020_/l2/pluginCollabCoreIndex', '/_102020_/l4/pluginCollabCoreIndex'],
  );
});

test('cache key with folder glued to _id_ and ?v=', () => {
  assert.deepEqual(
    localAliasCandidates('/local/_102033_cbe/cbeMiniCfe.js?v=bccbc73b'),
    ['/_102033_/l2/cbe/cbeMiniCfe.js', '/_102033_/l4/cbe/cbeMiniCfe.js'],
  );
});

test('slash after _id_ is stripped from the rest', () => {
  assert.deepEqual(
    localAliasCandidates('/local/_102020_/pasta/arquivo.js'),
    ['/_102020_/l2/pasta/arquivo.js', '/_102020_/l4/pasta/arquivo.js'],
  );
});

test('rejects traversal, non-numeric id, empty rest, and paths without _id_', () => {
  assert.deepEqual(localAliasCandidates('/local/_102020_foo/../bar'), []);
  assert.deepEqual(localAliasCandidates('/local/_abc_x'), []);
  assert.deepEqual(localAliasCandidates('/local/_102020_'), []);
  assert.deepEqual(localAliasCandidates('/local/x.js'), []);
});
