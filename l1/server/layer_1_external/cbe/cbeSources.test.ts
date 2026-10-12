/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeSources.test.ts" enhancement="_blank" />
// The path boundary of the source actions. It already guarded /exec; the
// GET /cbe/source view (cbeRoutes.handleSourceView) now reaches readSources
// with a path taken straight from a browser query string, so the rejection
// rules are worth pinning down on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSources, readSources, resolveSourcePath, writeSources } from '/_102034_/l1/server/layer_1_external/cbe/cbeSources.js';

const PROJECT_ID = 197001;

function g(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function withProject<T>(fn: (dir: string, root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'cbe-sources-'));
  const dir = join(root, `mls-${PROJECT_ID}`);
  mkdirSync(join(dir, 'l2'), { recursive: true });
  const prev = process.env.CBE_PROJECTS_DIR;
  process.env.CBE_PROJECTS_DIR = root;
  try {
    return fn(dir, root);
  } finally {
    if (prev === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

test('a path that escapes the project is refused', () => {
  withProject((_dir, root) => {
    const draft = join(root, 'draft-root');
    for (const shortPath of [
      '../secret.txt',
      'l2/../../secret.txt',
      '../mls-197002/l2/foo.ts',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'l2\\foo.ts',
      'l2/foo\0.ts',
      './foo.ts',
      '',
    ]) {
      assert.equal(resolveSourcePath(PROJECT_ID, shortPath), null, shortPath);
      assert.equal(resolveSourcePath(PROJECT_ID, shortPath, draft), null, `draft ${shortPath}`);
    }
  });
});

test('an out-of-range level is a folder name, not a rejection', () => {
  withProject((dir) => {
    // The pattern is shape, not a level filter: what makes this safe is that
    // the resolved path is still inside the project, which is asserted here.
    assert.equal(resolveSourcePath(PROJECT_ID, 'l0/foo.ts'), join(dir, 'l0', 'foo.ts'));
    assert.equal(resolveSourcePath(PROJECT_ID, 'l8/foo.ts'), join(dir, 'l8', 'foo.ts'));
  });
});

test('an ordinary path resolves inside the project', () => {
  withProject((dir) => {
    assert.equal(resolveSourcePath(PROJECT_ID, 'l2/foo.ts'), join(dir, 'l2', 'foo.ts'));
    // Level 0 has no level folder — a root file is still inside the project.
    assert.equal(resolveSourcePath(PROJECT_ID, 'mlsDep.json'), join(dir, 'mlsDep.json'));
  });
});

test('readSources reads text as utf8 and other files as base64', () => {
  withProject((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'const a = 1;\n');
    mkdirSync(join(dir, 'l3'), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(join(dir, 'l3', 'logo.png'), bytes);

    const [source] = readSources(PROJECT_ID, ['l2/foo.ts']);
    assert.equal(source.encoding, 'utf8');
    assert.equal(source.content, 'const a = 1;\n');

    const [asset] = readSources(PROJECT_ID, ['l3/logo.png']);
    assert.equal(asset.encoding, 'base64');
    assert.deepEqual(Buffer.from(asset.content, 'base64'), bytes);
  });
});

test('a refused path and a missing file both come back as nothing read', () => {
  withProject((dir, root) => {
    const outside = join(root, 'secret.txt');
    writeFileSync(outside, 'SECRET\n');
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');

    // Same empty answer either way: telling them apart would report on the
    // file system to whoever is guessing paths.
    assert.deepEqual(readSources(PROJECT_ID, ['../secret.txt']), []);
    assert.deepEqual(readSources(PROJECT_ID, ['l2/absent.ts']), []);
    // A directory is not a file, even though the path resolves.
    assert.deepEqual(readSources(PROJECT_ID, ['l2']), []);

    assert.ok(existsSync(outside));
    assert.equal(readFileSync(outside, 'utf8'), 'SECRET\n');
  });
});

test('one rejected path does not drop the valid ones in the same call', () => {
  withProject((dir) => {
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'a\n');
    const rc = readSources(PROJECT_ID, ['../secret.txt', 'l2/foo.ts']);
    assert.equal(rc.length, 1);
    assert.equal(rc[0].shortPath, 'l2/foo.ts');
  });
});

test('sourceRoot reads and writes the draft tree, not the project', () => {
  withProject((dir, root) => {
    const draft = join(root, 'drafts', 'team-x', `mls-${PROJECT_ID}`);
    mkdirSync(join(draft, 'l2'), { recursive: true });
    writeFileSync(join(dir, 'l2', 'foo.ts'), 'main\n');
    writeFileSync(join(draft, 'l2', 'foo.ts'), 'draft\n');

    assert.equal(resolveSourcePath(PROJECT_ID, 'l2/foo.ts'), join(dir, 'l2', 'foo.ts'));
    assert.equal(resolveSourcePath(PROJECT_ID, 'l2/foo.ts', draft), join(draft, 'l2', 'foo.ts'));
    assert.equal(resolveSourcePath(PROJECT_ID, 'l2/foo.ts', 'not/absolute'), null);

    const [fromDraft] = readSources(PROJECT_ID, ['l2/foo.ts'], draft);
    assert.equal(fromDraft.content, 'draft\n');
    const [fromMain] = readSources(PROJECT_ID, ['l2/foo.ts']);
    assert.equal(fromMain.content, 'main\n');

    const written = writeSources(
      PROJECT_ID,
      [{ shortPath: 'l2/bar.ts', content: 'new\n', encoding: 'utf8' }],
      [],
      { sourceRoot: draft },
    );
    assert.equal(written.ok, true);
    assert.deepEqual(written.paths, ['l2/bar.ts']);
    assert.equal(readFileSync(join(draft, 'l2', 'bar.ts'), 'utf8'), 'new\n');
    assert.equal(existsSync(join(dir, 'l2', 'bar.ts')), false);

    const removed = writeSources(PROJECT_ID, [], ['l2/foo.ts'], { sourceRoot: draft });
    assert.equal(removed.ok, true);
    assert.equal(existsSync(join(draft, 'l2', 'foo.ts')), false);
    assert.equal(readFileSync(join(dir, 'l2', 'foo.ts'), 'utf8'), 'main\n');

    const rejected = writeSources(
      PROJECT_ID,
      [{ shortPath: '../secret.txt', content: 'x', encoding: 'utf8' }],
      [],
      { sourceRoot: draft },
    );
    assert.equal(rejected.ok, false);
    assert.equal(existsSync(join(root, 'secret.txt')), false);
    assert.equal(existsSync(join(dir, 'l2', 'bar.ts')), false);
  });
});

test('listSources lists the draft worktree and drops files removed on that branch', () => {
  withProject((dir, root) => {
    writeFileSync(join(dir, 'l2', 'a.ts'), 'a\n');
    writeFileSync(join(dir, 'l2', 'b.ts'), 'b\n');
    g(dir, 'init', '-b', 'main');
    g(dir, 'add', '.');
    g(dir, 'commit', '-m', 'init');

    const wt = join(root, 'wt');
    g(dir, 'worktree', 'add', '-b', 'team/x', wt);
    rmSync(join(wt, 'l2', 'b.ts'));
    writeFileSync(join(wt, 'l2', 'c.ts'), 'c\n');
    g(wt, 'add', '-A');
    g(wt, 'commit', '-m', 'draft');

    const listed = listSources(PROJECT_ID, wt);
    const byPath = new Map(listed.map((file) => [file.shortPath, file]));
    assert.equal(byPath.get('l2/a.ts')?.versionRef, g(wt, 'hash-object', 'l2/a.ts'));
    assert.ok(byPath.has('l2/c.ts'));
    assert.equal(byPath.has('l2/b.ts'), false);
    for (const file of listed) assert.equal(file.jsContent, undefined);
  });
});

test('listSources without a git repo returns the production index and does not throw', () => {
  withProject((_dir, root) => {
    assert.deepEqual(listSources(PROJECT_ID), []);
    const bare = join(root, 'not-a-repo');
    mkdirSync(bare);
    const errors: string[] = [];
    const orig = console.error;
    console.error = ((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    }) as typeof console.error;
    try {
      assert.deepEqual(listSources(PROJECT_ID, bare), []);
    } finally {
      console.error = orig;
    }
    assert.ok(errors.some((line) => line.includes('[cbe] loadFilesInfo draft')));
  });
});
