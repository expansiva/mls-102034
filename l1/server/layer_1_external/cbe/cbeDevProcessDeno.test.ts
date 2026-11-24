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
let secretsKey = 'other';
let secretsError = null;
try {
  const value = Deno.env.get('COLLAB_SECRETS_KEY_FILE');
  secretsKey = value === undefined ? 'undefined' : 'present';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  secretsError = message;
  secretsKey = message.includes('NotCapable') || message.includes('Requires env access') ? 'not-capable' : 'other';
}
console.log('ST75 ' + JSON.stringify({ alpha, secretsKey, secretsError }));
`;

const SECRETS_SENTINEL = 'st79-secrets-key-should-not-leak';

test('draft deno --allow-env has no list: boot calls isAlphaAllAuthorities and an outside variable is undefined', async () => {
  assert.ok(DENO, 'deno not found (set DENO_BIN)');
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
  assert.equal(args.includes('--allow-env'), true);
  assert.equal(args.some((arg) => arg.startsWith('--allow-env=')), false);
  const previousSecrets = process.env.COLLAB_SECRETS_KEY_FILE;
  process.env.COLLAB_SECRETS_KEY_FILE = SECRETS_SENTINEL;
  try {
    const child = spawnSync(DENO, args, {
      cwd: mlsBase,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin:/usr/local/bin' },
      timeout: 180_000,
    });
    const detail = [child.stderr, child.stdout, child.error?.message, child.signal].filter(Boolean).join('\n');
    assert.equal(child.status, 0, detail);
    const line = (child.stdout ?? '').split('\n').find((item) => item.startsWith('ST75 '));
    assert.ok(line, detail);
    const report = JSON.parse(line.slice('ST75 '.length)) as { alpha: unknown; secretsKey: unknown; secretsError: unknown };
    assert.equal(typeof report.alpha, 'boolean');
    assert.equal(report.secretsKey, 'undefined');
    assert.equal(report.secretsError, null);
    assert.equal(detail.includes('NotCapable'), false);
    assert.equal(detail.includes(SECRETS_SENTINEL), false);
  } finally {
    if (previousSecrets === undefined) delete process.env.COLLAB_SECRETS_KEY_FILE;
    else process.env.COLLAB_SECRETS_KEY_FILE = previousSecrets;
    rmSync(dir, { recursive: true, force: true });
  }
});
