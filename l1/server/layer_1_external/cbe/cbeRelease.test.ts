/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeRelease.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';

const STAMP = {
  id: '20260917101300',
  libs: '20260904142119',
  client: '102047',
  versionRef: 'a71296f5c686aa00bc8807e521a157c4763d9e63',
  platformCommit: '40f9b425fbb3fc21d5dfa5cf379bdd5d2fa13906',
};

function withRelease(fn: (ctx: { root: string; deep: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'cbe-release-'));
  try {
    // Mesma profundidade do layout real: <release>/dist/local/_102034_/l1/server/layer_1_external/cbe
    const deep = join(root, 'dist', 'local', '_102034_', 'l1', 'server', 'layer_1_external', 'cbe');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(root, 'release.json'), JSON.stringify(STAMP, null, 2));
    fn({ root, deep });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('T1: acha o release.json subindo a partir do diretório do processo', () => {
  withRelease(({ root, deep }) => {
    assert.equal(findRelease(root)?.id, STAMP.id);
    // O cwd do pm2 é a raiz do release, mas subir de um nível fundo também resolve.
    assert.equal(findRelease(deep)?.versionRef, STAMP.versionRef);
  });
});

test('T2: sem release.json (checkout de dev) devolve null, não erro', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-release-'));
  try {
    assert.equal(findRelease(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('T3: um release.json corrompido não derruba o ping', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-release-'));
  try {
    writeFileSync(join(root, 'release.json'), '{ isso não é json');
    assert.equal(findRelease(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('T4: um release.json sem id é ignorado', () => {
  const root = mkdtempSync(join(tmpdir(), 'cbe-release-'));
  try {
    writeFileSync(join(root, 'release.json'), JSON.stringify({ libs: '2026' }));
    assert.equal(findRelease(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
