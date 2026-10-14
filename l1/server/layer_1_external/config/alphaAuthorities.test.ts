/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { isAlphaAllAuthorities, moduleActorRefs, resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';

function writeMap(controllersDir: string, source: string): void {
  const path = resolveProjectDistPath(`${controllersDir.replace(/\/$/u, '')}/../../auth/authorityMap.js`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

test('alphaAllAuthorities: só `true` no config.json liga; false, string ou ausente não ligam', () => {
  const cases: Array<{ body: { alphaAllAuthorities?: unknown }; on: boolean }> = [
    { body: { alphaAllAuthorities: true }, on: true },
    { body: { alphaAllAuthorities: false }, on: false },
    { body: { alphaAllAuthorities: 'true' }, on: false },
    { body: {}, on: false },
  ];
  for (const item of cases) {
    resetAlphaAuthoritiesCache();
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (message?: unknown) => {
      warns.push(String(message));
    };
    try {
      assert.equal(isAlphaAllAuthorities(undefined, () => item.body), item.on);
      assert.equal(isAlphaAllAuthorities('102056', () => ({ alphaAllAuthorities: !item.on })), item.on);
    } finally {
      console.warn = orig;
    }
    if (item.on) {
      assert.equal(warns.length, 1);
      assert.match(warns[0], /^\[alpha\] alphaAllAuthorities ON \(config\.json\) — /);
    } else {
      assert.deepEqual(warns, []);
    }
  }
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

// 13/10/2026: the generated L1 keeps its controllers one level deeper (layer_1_external/adapters/http/controllers)
// and the map in layer_1_external/auth/. Only `../../auth/` was tried, so every current module got [] and the
// alpha super user added no actor (reembolsoDespesas answered FORBIDDEN_ACTOR).
test('moduleActorRefs: the current L1 layout (adapters/http/controllers → layer_1_external/auth) is found too', async () => {
  resetAlphaAuthoritiesCache();
  const controllers = '_990013_/l1/modC/layer_1_external/adapters/http/controllers';
  const mapPath = resolveProjectDistPath('_990013_/l1/modC/layer_1_external/auth/authorityMap.js');
  mkdirSync(dirname(mapPath), { recursive: true });
  writeFileSync(mapPath, 'export const entries = [{ grantId: "a", actorRef: "colaborador" }, { grantId: "b", actorRef: "gestorEquipe" }, { grantId: "c", actorRef: "financeiro" }];\n');
  try {
    assert.deepEqual(await moduleActorRefs(controllers), ['colaborador', 'gestorEquipe', 'financeiro']);
    assert.deepEqual(await moduleActorRefs(`${controllers}/`), ['colaborador', 'gestorEquipe', 'financeiro'], 'a trailing slash changes nothing');
  } finally {
    rmSync(resolveProjectDistPath('_990013_'), { recursive: true, force: true });
  }
});
