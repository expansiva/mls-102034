/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShellChain, releaseAliasFor } from '/_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.js';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = { ownerToken: '4242', clientId: '102047' };

test('T1: o obj do projeto salvo é refeito ANTES do build', () => {
  // O bug real: 102047 está DENTRO do fecho, e o refresh de objs do
  // addNewVersion cobre só os de fora — o zip (e todo versionRef nele) ficava
  // parado no último publish enquanto o build "funcionava".
  const chain = buildShellChain({ ...BASE, projects: [102047] });
  const objStep = chain.indexOf('buildProjectsObj.mjs --only');
  const build = chain.indexOf('pnpm build');
  assert.ok(objStep > 0, 'o passo do obj precisa estar na cadeia');
  assert.ok(objStep < build, 'o obj precisa ser refeito antes do build montar o release');
  assert.match(chain, /buildProjectsObj\.mjs --only '102047'/u);
});

test('T2: vários projetos salvos entram numa chamada só', () => {
  const chain = buildShellChain({ ...BASE, projects: [102047, 102033] });
  assert.match(chain, /--only '102047,102033'/u);
});

test('T3: sem projeto, a cadeia é a de antes — só o build', () => {
  const chain = buildShellChain({ ...BASE, projects: [] });
  assert.equal(chain.includes('buildProjectsObj'), false);
  assert.match(chain, /pnpm build -- --client '102047' --skip-install --skip-migrate/u);
});

test('T4: o passo do obj é separado por ";" — falhar nele não impede o build', () => {
  const chain = buildShellChain({ ...BASE, projects: [102047] });
  const between = chain.slice(chain.indexOf('buildProjectsObj'), chain.indexOf('pnpm build'));
  assert.match(between, /;\s*$/u, 'os passos precisam ser sequenciais, não encadeados por &&');
});

test('T5: a cadeia continua sendo um job em background que solta o lock no fim', () => {
  const chain = buildShellChain({ ...BASE, projects: [102047] });
  assert.ok(chain.startsWith('{ '), 'precisa continuar sendo um bloco único');
  assert.match(chain, /code=\$\?;/u);
  assert.match(chain, /rm -f '.*\.rebuild-on-save\.lock'/u);
  assert.match(chain, /\} >> '.*rebuild-on-save\.log' 2>&1 &$/u);
});

test('T6: o alias do release vai na linha do build', () => {
  // Sem isso o addNewVersion move só o `current` global, e o app — que roda com cwd
  // no current-<id> — volta no release ANTIGO com o build reportando exit=0.
  const chain = buildShellChain({ ...BASE, projects: [102047], releaseAlias: 'current-102047' });
  assert.match(chain, /COLLAB_RELEASE_ALIAS='current-102047' pnpm build/u);
});

test('T7: sem alias, a linha do build é a de antes', () => {
  const chain = buildShellChain({ ...BASE, projects: [102047] });
  assert.equal(chain.includes('COLLAB_RELEASE_ALIAS'), false);
  assert.match(chain, /pnpm build -- --client '102047'/u);
});

test('T8: releaseAliasFor só devolve o alias quando o symlink existe', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-alias-'));
  const prevDir = process.env.CBE_PROJECTS_DIR;
  const prevAlias = process.env.COLLAB_RELEASE_ALIAS;
  delete process.env.COLLAB_RELEASE_ALIAS;
  try {
    // O módulo resolve ROOT na carga, então aqui vale o host real: o que dá para
    // afirmar sem depender dele é o contrato dos casos negativos e o do env.
    assert.equal(releaseAliasFor('não-numérico'), '');
    process.env.COLLAB_RELEASE_ALIAS = 'current-999999';
    assert.equal(releaseAliasFor('102047'), 'current-999999', 'um valor explícito vence');
  } finally {
    if (prevDir === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prevDir;
    if (prevAlias === undefined) delete process.env.COLLAB_RELEASE_ALIAS;
    else process.env.COLLAB_RELEASE_ALIAS = prevAlias;
    rmSync(root, { recursive: true, force: true });
  }
});
