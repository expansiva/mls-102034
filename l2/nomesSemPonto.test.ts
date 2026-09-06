/// <mls fileReference="_102034_/l2/nomesSemPonto.test.ts" enhancement="_blank"/>

// File shortNames never contain a dot (nomes_sem_ponto). Studio splits
// `shortName` + `extension`; `x.logic.ts` becomes shortName `x.logic` and
// hits the service-worker versionRef-0 family.
//
// This guard only READS. It never renames.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAYERS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'] as const;
const SKIP_DIRS = new Set(['node_modules', 'obj', 'dist', '.git']);
const KNOWN_EXTENSIONS = ['.defs.ts', '.test.ts', '.d.ts', '.ts', '.less', '.html'] as const;
const RULE =
  'file shortName must not contain a dot; allowed extensions (one, compound first): .defs.ts, .test.ts, .d.ts, .ts, .less, .html';

type KnownExtension = (typeof KNOWN_EXTENSIONS)[number];

type FileNameClass =
  | { kind: 'ignored' }
  | { kind: 'ok'; shortName: string; extension: KnownExtension }
  | { kind: 'violation'; shortName: string; extension: KnownExtension };

function classifyFileName(fileName: string): FileNameClass {
  for (const extension of KNOWN_EXTENSIONS) {
    if (!fileName.endsWith(extension)) continue;
    const shortName = fileName.slice(0, -extension.length);
    if (shortName.includes('.')) return { kind: 'violation', shortName, extension };
    return { kind: 'ok', shortName, extension };
  }
  return { kind: 'ignored' };
}

function walk(dir: string, projectRoot: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, projectRoot, out);
      continue;
    }
    const classified = classifyFileName(entry);
    if (classified.kind !== 'violation') continue;
    const rel = relative(projectRoot, full).replace(/\\/g, '/');
    out.push(
      `${rel}: shortName "${classified.shortName}" contains a dot after removing "${classified.extension}". ${RULE}`,
    );
  }
}

function findNomesSemPontoViolations(projectRoot: string): string[] {
  const out: string[] = [];
  for (const layer of LAYERS) walk(join(projectRoot, layer), projectRoot, out);
  return out.sort();
}

const CLASSIFY_CASES: { name: string; kind: FileNameClass['kind']; shortName?: string; extension?: KnownExtension }[] = [
  { name: 'page.test.ts', kind: 'ok', shortName: 'page', extension: '.test.ts' },
  { name: 'serviceCatalogue.defs.ts', kind: 'ok', shortName: 'serviceCatalogue', extension: '.defs.ts' },
  { name: 'ml-scenary.less', kind: 'ok', shortName: 'ml-scenary', extension: '.less' },
  { name: 'x.d.ts', kind: 'ok', shortName: 'x', extension: '.d.ts' },
  { name: 'ml-scenary.ts', kind: 'ok', shortName: 'ml-scenary', extension: '.ts' },
  { name: 'index.html', kind: 'ok', shortName: 'index', extension: '.html' },
  { name: 'cbeAdmZip.d.ts', kind: 'ok', shortName: 'cbeAdmZip', extension: '.d.ts' },
  { name: 'ml-scenary.logic.ts', kind: 'violation', shortName: 'ml-scenary.logic', extension: '.ts' },
  { name: 'auraStateEdit.stub.ts', kind: 'violation', shortName: 'auraStateEdit.stub', extension: '.ts' },
  { name: 'a.b.less', kind: 'violation', shortName: 'a.b', extension: '.less' },
  { name: 'x.tmp.ts', kind: 'violation', shortName: 'x.tmp', extension: '.ts' },
  { name: 'cfeCreateShared.splitPlan.test.ts', kind: 'violation', shortName: 'cfeCreateShared.splitPlan', extension: '.test.ts' },
  { name: 'foo.schema.json', kind: 'ignored' },
  { name: 'readme.md', kind: 'ignored' },
  { name: 'icon.png', kind: 'ignored' },
];

test('classifyFileName: compound extensions first, extra dots fail, schema/md/png ignored', () => {
  for (const row of CLASSIFY_CASES) {
    const got = classifyFileName(row.name);
    assert.equal(got.kind, row.kind, `${row.name}: kind`);
    if (got.kind === 'ignored') continue;
    assert.equal(got.shortName, row.shortName, `${row.name}: shortName`);
    assert.equal(got.extension, row.extension, `${row.name}: extension`);
  }
});

test('l1..l7 have no extra-dot names; a temporary x.tmp.ts is reported and reverted', () => {
  const clean = findNomesSemPontoViolations(PROJECT_ROOT);
  assert.deepEqual(clean, [], `\n${clean.join('\n')}\n`);

  const tmp = join(PROJECT_ROOT, 'l2', 'x.tmp.ts');
  writeFileSync(tmp, '// nomesSemPonto mutation\n');
  try {
    const dirty = findNomesSemPontoViolations(PROJECT_ROOT);
    const hit = dirty.filter(line => line.includes('x.tmp.ts'));
    assert.equal(hit.length, 1, `expected one x.tmp.ts hit, got:\n${dirty.join('\n')}`);
    assert.match(hit[0], /x\.tmp\.ts/);
    assert.match(hit[0], /shortName "x\.tmp"/);
    assert.match(hit[0], /must not contain a dot/);
  } finally {
    unlinkSync(tmp);
  }
});
