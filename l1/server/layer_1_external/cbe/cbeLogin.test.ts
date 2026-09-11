/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLogin.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { buildProjectSettings, readProjectSettings } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import type { ProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { L5ProjectJson, ProjectSettingsConfig } from '/_102029_/l2/runtimeConfigTypes.js';

const DEFAULT_VALUE = JSON.stringify({ projectDriver: 'GitHub', projectURL: 'local/local/local' });

let nextProjectId = 199001;

function allocProjectId(): number {
  return nextProjectId++;
}

function withProjectsDir<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'cbe-login-'));
  const prev = process.env.CBE_PROJECTS_DIR;
  process.env.CBE_PROJECTS_DIR = root;
  try {
    return fn(root);
  } finally {
    if (prev === undefined) delete process.env.CBE_PROJECTS_DIR;
    else process.env.CBE_PROJECTS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeCompiledZip(root: string, projectId: number): void {
  const zip = new AdmZip();
  zip.addFile('fileinfos.json', Buffer.from(JSON.stringify({
    files: [{ shortPath: 'l2/foo.ts' }],
    lastModified: '2099-01-01T00:00:00.000Z',
  })));
  const dir = join(root, `mls-${projectId}`, 'obj');
  mkdirSync(dir, { recursive: true });
  zip.writeZip(join(dir, 'compiled.zip'));
}

function writeJson(root: string, projectId: number, relativePath: string, body: string | object): void {
  const dir = join(root, `mls-${projectId}`, 'l5');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, relativePath), typeof body === 'string' ? body : JSON.stringify(body));
}

function captureWarns(fn: () => void): string[] {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = ((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  }) as typeof console.warn;
  try {
    fn();
    return warns;
  } finally {
    console.warn = orig;
  }
}

function parseValue(value: string): { projectDriver: string; projectURL: string } {
  return JSON.parse(value) as { projectDriver: string; projectURL: string };
}

test('T1: l5/config.json with valid projectSettings fills value from the file', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    writeJson(root, id, 'config.json', {
      projectSettings: { driver: 'GitLab', url: 'main/expansiva/mls-102025' },
    });
    const settings = buildProjectSettings(id, []);
    assert.ok(settings);
    assert.deepEqual(parseValue(settings.value), {
      projectDriver: 'GitLab',
      projectURL: 'main/expansiva/mls-102025',
    });
  });
});

test('T2: missing file uses today\'s default and warns once', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    const warns = captureWarns(() => {
      const settings = buildProjectSettings(id, []);
      assert.ok(settings);
      assert.equal(settings.value, DEFAULT_VALUE);
    });
    const relevant = warns.filter((line) => line.includes('projectSettings absent — using default'));
    assert.equal(relevant.length, 1, `expected one absent warning, got: ${warns.join(' | ')}`);
    assert.match(relevant[0], new RegExp(`\\[cbe\\] project ${id}: projectSettings absent — using default`));
  });
});

test('T3: invalid JSON uses the default and does not throw', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    writeJson(root, id, 'config.json', '{ not json');
    captureWarns(() => {
      assert.doesNotThrow(() => {
        const fromReader = readProjectSettings(id);
        assert.equal(fromReader.driver, 'GitHub');
        assert.equal(fromReader.url, 'local/local/local');
        const settings = buildProjectSettings(id, []);
        assert.ok(settings);
        assert.equal(settings.value, DEFAULT_VALUE);
      });
    });
  });
});

test('T4: url with 2 segments is refused; warning cites getMyKeysBranch', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    writeJson(root, id, 'config.json', {
      projectSettings: { driver: 'GitHub', url: 'local/local' },
    });
    const warns = captureWarns(() => {
      const settings = buildProjectSettings(id, []);
      assert.ok(settings);
      assert.equal(settings.value, DEFAULT_VALUE);
    });
    assert.match(warns.join('\n'), /getMyKeysBranch/);
  });
});

test('T5: url with a trailing slash is accepted (slash stripped before counting)', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    const url = 'https://github.com/main/expansiva/mls-102025/';
    writeJson(root, id, 'config.json', {
      projectSettings: { driver: 'GitHub', url },
    });
    const settings = buildProjectSettings(id, []);
    assert.ok(settings);
    assert.deepEqual(parseValue(settings.value), { projectDriver: 'GitHub', projectURL: url });
  });
});

test('T6: name and userAuth in the block win over readProjectName and public', () => {
  withProjectsDir((root) => {
    const id = allocProjectId();
    writeCompiledZip(root, id);
    writeJson(root, id, 'project.json', { name: 'from-project-json' });
    writeJson(root, id, 'config.json', {
      projectSettings: {
        driver: 'vm',
        url: 'local/local/mls-199000',
        name: 'from-settings',
        userAuth: 'private',
      },
    });
    const settings = buildProjectSettings(id, []);
    assert.ok(settings);
    assert.equal(settings.name, 'from-settings');
    assert.equal(settings.userAuth, 'private');
    assert.deepEqual(parseValue(settings.value), {
      projectDriver: 'vm',
      projectURL: 'local/local/mls-199000',
    });
  });
});

test('T7: ProjectsConfig accepts projectSettings and workspaceDependencies; L5ProjectJson accepts name', () => {
  const projectSettings: ProjectSettingsConfig = {
    driver: 'GitHub',
    url: 'main/expansiva/mls-102025',
    name: 'lib',
    userAuth: 'public',
  };
  const config: ProjectsConfig = {
    defaultProjectId: '1',
    shellTemplates: { spa: './spa.html', pwa: './pwa.html' },
    workspaceDependencies: ['102029'],
    projectSettings,
    projects: { '1': { root: '.' } },
  };
  assert.equal(config.projectSettings?.driver, 'GitHub');
  assert.deepEqual(config.workspaceDependencies, ['102029']);
  const project: L5ProjectJson = { name: 'from-project-json' };
  assert.equal(project.name, 'from-project-json');
});
