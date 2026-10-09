/// <mls fileReference="_102034_/l1/server/layer_1_external/config/alphaAuthorities.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveProjectDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { isAlphaAllAuthorities, moduleActorRefs, resetAlphaAuthoritiesCache } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';

function writeJson(projectId: string, body: unknown): void {
  const path = resolveProjectDistPath(`_${projectId}_/l5/project.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
}

function writeMap(controllersDir: string, source: string): void {
  const path = resolveProjectDistPath(`${controllersDir.replace(/\/$/u, '')}/../../auth/authorityMap.js`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

test('alphaAllAuthorities: true liga; false, ausente ou string não ligam', () => {
  resetAlphaAuthoritiesCache();
  writeJson('990001', { alphaAllAuthorities: true });
  writeJson('990002', { alphaAllAuthorities: false });
  writeJson('990003', { appEnv: 'presentation' });
  writeJson('990004', { alphaAllAuthorities: 'true' });
  assert.equal(isAlphaAllAuthorities('990001'), true);
  assert.equal(isAlphaAllAuthorities('990002'), false);
  assert.equal(isAlphaAllAuthorities('990003'), false);
  assert.equal(isAlphaAllAuthorities('990004'), false);
  assert.equal(isAlphaAllAuthorities('990099'), false);
  rmSync(dirname(resolveProjectDistPath('_990001_/l5/project.json')), { recursive: true, force: true });
  rmSync(dirname(resolveProjectDistPath('_990002_/l5/project.json')), { recursive: true, force: true });
  rmSync(dirname(resolveProjectDistPath('_990003_/l5/project.json')), { recursive: true, force: true });
  rmSync(dirname(resolveProjectDistPath('_990004_/l5/project.json')), { recursive: true, force: true });
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
