/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { isAlphaAllAuthorities, moduleActorRefs, resetAlphaAuthoritiesCache, runtimeFlagsFile } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';

function writeMap(controllersDir: string, source: string): void {
  const path = resolveProjectDistPath(`${controllersDir.replace(/\/$/u, '')}/../../auth/authorityMap.js`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function writeFlags(file: string, body: unknown, mtimeSeconds: number): void {
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  utimesSync(file, mtimeSeconds, mtimeSeconds);
}

test('alphaAllAuthorities: só `true` no arquivo da VM liga; false, string, JSON inválido ou sem arquivo não ligam', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-'));
  const file = join(dir, 'runtime-flags.json');
  try {
    resetAlphaAuthoritiesCache();
    assert.equal(isAlphaAllAuthorities(undefined, file), false);
    writeFlags(file, { alphaAllAuthorities: true }, 1000);
    assert.equal(isAlphaAllAuthorities(undefined, file), true);
    writeFlags(file, { alphaAllAuthorities: false }, 1001);
    assert.equal(isAlphaAllAuthorities(undefined, file), false);
    writeFlags(file, { alphaAllAuthorities: 'true' }, 1002);
    assert.equal(isAlphaAllAuthorities(undefined, file), false);
    writeFlags(file, '{not json', 1003);
    assert.equal(isAlphaAllAuthorities(undefined, file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('alphaAllAuthorities: liga e desliga sem reiniciar, pelo mtime do arquivo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alpha-'));
  const file = join(dir, 'runtime-flags.json');
  try {
    resetAlphaAuthoritiesCache();
    writeFlags(file, { alphaAllAuthorities: true }, 2000);
    assert.equal(isAlphaAllAuthorities('102056', file), true);
    writeFlags(file, { alphaAllAuthorities: false }, 2001);
    assert.equal(isAlphaAllAuthorities('102056', file), false);
    rmSync(file);
    assert.equal(isAlphaAllAuthorities('102056', file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtimeFlagsFile: /data/mls-base por padrão; COLLAB_RUNTIME_FLAGS_FILE sobrepõe', () => {
  assert.equal(runtimeFlagsFile({}), '/data/mls-base/runtime-flags.json');
  assert.equal(runtimeFlagsFile({ COLLAB_RUNTIME_FLAGS_FILE: '/tmp/x.json' }), '/tmp/x.json');
  assert.equal(runtimeFlagsFile({ COLLAB_RUNTIME_FLAGS_FILE: '  ' }), '/data/mls-base/runtime-flags.json');
});

test('moduleActorRefs: mapa com caixa/garcom devolve os dois; sem mapa, []', async () => {
  resetAlphaAuthoritiesCache();
  const withMap = '_990011_/l1/modA/layer_2_controllers';
  const withoutMap = '_990012_/l1/modB/layer_2_controllers';
  writeMap(withMap, 'export const entries = [{ grantId: "a", actorRef: "caixa" }, { grantId: "b", actorRef: "garcom" }, { grantId: "c", actorRef: "caixa" }];\n');
  assert.deepEqual(await moduleActorRefs(withMap), ['caixa', 'garcom']);
  assert.deepEqual(await moduleActorRefs(withoutMap), []);
  rmSync(resolveProjectDistPath('_990011_'), { recursive: true, force: true });
  rmSync(resolveProjectDistPath('_990012_'), { recursive: true, force: true });
});
