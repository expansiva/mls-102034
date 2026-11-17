/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDevProcessDeno.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildDenoArgs } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

/** DENO_BIN, then ~/.deno/bin/deno, then `deno` on PATH. Null when none runs: the test then skips and says so. */
function findDeno(): string | null {
  const candidates = [process.env.DENO_BIN, join(homedir(), '.deno', 'bin', 'deno'), 'deno'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 20_000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}
const DENO = findDeno();
const SLUG = 'st75-alpha';
const PORT = 4100;
const DATABASE_URL = 'postgres://127.0.0.1:5432/collab_app_draft_st75';

const here = dirname(fileURLToPath(import.meta.url));
const mlsBase = join(here, '..', '..', '..', '..', '..');

interface DraftDenoConfigModule {
  buildDraftDenoConfig(input: { base: string; slug: string; clientProjectId: number }): Record<string, unknown>;
}

async function loadDraftDenoConfigModule(): Promise<DraftDenoConfigModule> {
  const file = join(mlsBase, 'scripts', 'runtime', 'denoDraftConfig.mjs');
  return await import(pathToFileURL(file).href) as DraftDenoConfigModule;
}

const ENTRY = `
const { isAlphaAllAuthorities } = await import('/_102034_/l1/server/layer_1_external/config/alphaAuthorities.ts');
const alpha = isAlphaAllAuthorities();
if (typeof alpha !== 'boolean') throw new Error('isAlphaAllAuthorities did not return a boolean');
console.log('ST75 ' + JSON.stringify({ alpha }));
`;

test('draft deno allow-env lets boot call isAlphaAllAuthorities', { skip: DENO === null ? 'deno not found (set DENO_BIN)' : false }, async () => {
  const { buildDraftDenoConfig } = await loadDraftDenoConfigModule();
  const dir = mkdtempSync(join(tmpdir(), 'cbe-st75-'));
  const configPath = join(dir, 'deno.json');
  const entry = join(dir, 'bootAlpha.ts');
  writeFileSync(configPath, `${JSON.stringify(buildDraftDenoConfig({
    base: mlsBase,
    slug: SLUG,
    clientProjectId: 102047,
  }), null, 2)}\n`);
  writeFileSync(entry, ENTRY);
  const args = buildDenoArgs(mlsBase, SLUG, PORT, DATABASE_URL);
  const configAt = args.indexOf('--config');
  assert.ok(configAt > 0);
  args[configAt + 1] = configPath;
  args[args.length - 1] = entry;
  args.splice(configAt, 0, '--no-prompt');
  const allowEnv = args.find((arg) => arg.startsWith('--allow-env='));
  assert.ok(allowEnv);
  assert.equal(allowEnv.includes('DATABASE_URL,'), false);
  assert.equal(allowEnv.endsWith(',DATABASE_URL'), false);
  try {
    const child = spawnSync(DENO as string, args, {
      cwd: mlsBase,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin:/usr/local/bin' },
      timeout: 180_000,
    });
    const detail = [child.stderr, child.stdout, child.error?.message, child.signal].filter(Boolean).join('\n');
    assert.equal(child.status, 0, detail);
    const line = (child.stdout ?? '').split('\n').find((item) => item.startsWith('ST75 '));
    assert.ok(line, detail);
    const report = JSON.parse(line.slice('ST75 '.length)) as { alpha: unknown };
    assert.equal(typeof report.alpha, 'boolean');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
