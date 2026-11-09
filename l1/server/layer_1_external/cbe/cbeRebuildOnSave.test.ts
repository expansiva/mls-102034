/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShellChain, releaseAliasFor } from '/_102034_/l1/server/layer_1_external/cbe/cbeRebuildOnSave.js';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// rt202: a build that never starts must say why. The module fixes its root and env at import, so it runs in a child.
function runProbe(env: Record<string, string>, root: string, waitMs = 6000): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const monorepoRoot = join(here, '..', '..', '..', '..', '..');
  const result = spawnSync(join(monorepoRoot, 'node_modules', '.bin', 'tsx'), [
    '--import', join(monorepoRoot, 'test', 'register-hooks.mjs'),
    '--import', join(monorepoRoot, 'test', 'setup-l1.ts'),
    join(here, 'cbeRebuildOnSaveProbe.ts'), String(waitMs),
  ], {
    cwd: join(monorepoRoot, 'mls-102034', 'l1'),
    encoding: 'utf8',
    env: { ...process.env, TSX_TSCONFIG_PATH: join(monorepoRoot, 'test', 'tsconfig.runtime.json'), CBE_PROJECTS_DIR: root, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  const logPath = join(root, 'logs', 'rebuild-on-save.log');
  return existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
}

test('T9: rebuild desligada loga POR QUE (e o log existe), e não lança nada', () => {
  const root = mkdtempSync(join(tmpdir(), 'rebuild-off-'));
  try {
    const log = runProbe({ NODE_ENV: 'development', CBE_REBUILD_ON_SAVE: '' }, root, 300);
    assert.match(log, /\[rebuild-on-save\] disabled, release NOT scheduled for project 102047 \(CBE_REBUILD_ON_SAVE= NODE_ENV=development\)/u);
    assert.doesNotMatch(log, /=== rebuild-on-save start/u);
    const never = runProbe({ NODE_ENV: 'production', CBE_REBUILD_ON_SAVE: 'never' }, root, 300);
    assert.match(never, /disabled, release NOT scheduled for project 102047 \(CBE_REBUILD_ON_SAVE=never NODE_ENV=production\)/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('T10: habilitada, cada passo deixa linha (agendou, tentou, lançou) e a cadeia roda até o fim', () => {
  const root = mkdtempSync(join(tmpdir(), 'rebuild-on-'));
  try {
    mkdirSync(join(root, 'scripts', 'runtime'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'runtime', 'buildProjectsObj.mjs'), "console.log('stub buildProjectsObj');\n");
    writeFileSync(join(root, 'package.json'), '{}\n');
    writeFileSync(join(root, 'bin', 'pnpm'), '#!/bin/sh\necho "stub pnpm $@"\n');
    chmodSync(join(root, 'bin', 'pnpm'), 0o755);
    const log = runProbe({ NODE_ENV: 'production', PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}` }, root, 7000);
    assert.match(log, /scheduled for project 102047 in \d+ ms \(root /u);
    assert.match(log, /attempt \(pid \d+\)/u);
    assert.match(log, /launched client=102047 projects=102047 owner=\d+/u);
    assert.match(log, /=== rebuild-on-save start .* client=102047 projects=102047 ===/u);
    assert.match(log, /stub pnpm build -- --client 102047 --skip-install --skip-migrate/u);
    assert.match(log, /=== rebuild-on-save end .* exit=0 ===/u);
    assert.equal(existsSync(join(root, '.rebuild-on-save.lock')), false, 'a cadeia solta o lock no fim');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
