/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLogin.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { announcedProjectDriver, buildProjectSettings, readProjectFile, readProjectSettings, resolveOrgInfo } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import type { ProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import type { L5ProjectJson, ProjectSettingsConfig } from '/_102029_/l2/runtimeConfigTypes.js';

const DEFAULT_VALUE = JSON.stringify({ projectDriver: 'vm', projectURL: 'local/local/local' });

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

function captureErrors(fn: () => void): string[] {
  const errors: string[] = [];
  const orig = console.error;
  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  }) as typeof console.error;
  try {
    fn();
    return errors;
  } finally {
    console.error = orig;
  }
}

function withProjectFilesDir<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'cbe-project-files-'));
  const prev = process.env.CBE_PROJECT_FILES_DIR;
  process.env.CBE_PROJECT_FILES_DIR = root;
  try {
    return fn(root);
  } finally {
    if (prev === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
    else process.env.CBE_PROJECT_FILES_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeProjectFile(root: string, projectId: number, body: string | object): void {
  writeFileSync(join(root, `${projectId}.json`), typeof body === 'string' ? body : JSON.stringify(body));
}

function sampleProjectFile(orgId: string, slug: string, projectId: number, extra: object = {}): object {
  return {
    schema: 1,
    generatedAt: '2026-10-01T00:00:00.000Z',
    org: { orgId, slug, name: `Name of ${slug}`, createdAt: '2026-01-01T00:00:00.000Z' },
    project: { projectId: String(projectId), domain: null, appEnv: null, language: null, type: 'client', createdAt: '2026-02-01T00:00:00.000Z' },
    ...extra,
  };
}

function parseValue(value: string): { projectDriver: string; projectURL: string } {
  return JSON.parse(value) as { projectDriver: string; projectURL: string };
}

test('announcedProjectDriver: absent env keeps the declared driver', () => {
  assert.equal(announcedProjectDriver('GitHub', {}), 'GitHub');
});

test('announcedProjectDriver: CBE_PROJECT_DRIVER_OVERRIDE=vm replaces the declared driver', () => {
  assert.equal(announcedProjectDriver('GitHub', { CBE_PROJECT_DRIVER_OVERRIDE: 'vm' }), 'vm');
});

test('announcedProjectDriver: whitespace-only override is absent', () => {
  assert.equal(announcedProjectDriver('GitHub', { CBE_PROJECT_DRIVER_OVERRIDE: '   ' }), 'GitHub');
});

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
        assert.equal(fromReader.driver, 'vm');
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

test('T8: valid project file -> org org/<slug>, created_at and owner filled', () => {
  withProjectsDir((root) => {
    withProjectFilesDir((filesRoot) => {
      const id = allocProjectId();
      writeCompiledZip(root, id);
      writeProjectFile(filesRoot, id, sampleProjectFile('org-1', 'acme', id));

      const orgInfo = resolveOrgInfo([id]);
      assert.deepEqual(orgInfo, { slug: 'acme', name: 'Name of acme', createdAt: '2026-01-01T00:00:00.000Z' });

      const project = buildProjectSettings(id, []);
      assert.ok(project);
      assert.equal(project?.owner, 'acme');
      assert.equal(project?.created_at, '2026-02-01T00:00:00.000Z');
    });
  });
});

test('T9: one project with file and one dependency without -> both land in the file\'s org', () => {
  withProjectsDir((root) => {
    withProjectFilesDir((filesRoot) => {
      const withFile = allocProjectId();
      const withoutFile = allocProjectId();
      writeCompiledZip(root, withFile);
      writeCompiledZip(root, withoutFile);
      writeProjectFile(filesRoot, withFile, sampleProjectFile('org-2', 'beta', withFile));

      const orgInfo = resolveOrgInfo([withFile, withoutFile]);
      assert.equal(orgInfo.slug, 'beta');

      const depProject = buildProjectSettings(withoutFile, []);
      assert.ok(depProject);
      assert.equal(depProject?.owner, 'local');
      assert.equal(depProject?.created_at, '');
    });
  });
});

test('T10: no project files -> org local with a single process-wide warning', () => {
  withProjectFilesDir(() => {
    const id = allocProjectId();
    const warns = captureWarns(() => {
      assert.deepEqual(resolveOrgInfo([id]), { slug: 'local', name: 'local', createdAt: '' });
      assert.deepEqual(resolveOrgInfo([id]), { slug: 'local', name: 'local', createdAt: '' });
    });
    const relevant = warns.filter((line) => line.includes('no project file under'));
    assert.equal(relevant.length, 1, `expected one process-wide warning, got: ${warns.join(' | ')}`);
  });
});

test('T11: invalid project file -> console.error once per mtime, treated as absent', () => {
  withProjectFilesDir((filesRoot) => {
    const id = allocProjectId();
    writeProjectFile(filesRoot, id, '{ not json');
    const errors = captureErrors(() => {
      assert.equal(readProjectFile(id), null);
      assert.equal(readProjectFile(id), null);
    });
    const relevant = errors.filter((line) => line.includes(`project ${id}`) && line.includes('unreadable'));
    assert.equal(relevant.length, 1, `expected one error for the unchanged mtime, got: ${errors.join(' | ')}`);
  });
});

test('T12: project files report different org ids -> error once, org local', () => {
  withProjectFilesDir((filesRoot) => {
    const idA = allocProjectId();
    const idB = allocProjectId();
    writeProjectFile(filesRoot, idA, sampleProjectFile('org-a', 'alpha', idA));
    writeProjectFile(filesRoot, idB, sampleProjectFile('org-b', 'bravo', idB));
    const errors = captureErrors(() => {
      assert.equal(resolveOrgInfo([idA, idB]).slug, 'local');
      assert.equal(resolveOrgInfo([idA, idB]).slug, 'local');
    });
    const relevant = errors.filter((line) => line.includes('different org ids'));
    assert.equal(relevant.length, 1, `expected one error for the unchanged mtimes, got: ${errors.join(' | ')}`);
  });
});

test('T13: schema 2 with an extra field is read as v1', () => {
  withProjectFilesDir((filesRoot) => {
    const id = allocProjectId();
    writeProjectFile(filesRoot, id, { ...sampleProjectFile('org-c', 'charlie', id), schema: 2, future: { field: true } });
    const file = readProjectFile(id);
    assert.ok(file);
    assert.equal(file?.org.slug, 'charlie');
    assert.equal(file?.schema, 2);
  });
});

test('T14: rewritten project file (new mtime) is re-read', () => {
  withProjectFilesDir((filesRoot) => {
    const id = allocProjectId();
    const filePath = join(filesRoot, `${id}.json`);
    writeProjectFile(filesRoot, id, sampleProjectFile('org-d', 'delta', id));
    assert.equal(readProjectFile(id)?.org.slug, 'delta');

    writeProjectFile(filesRoot, id, sampleProjectFile('org-e', 'echo', id));
    const future = new Date(Date.now() + 5000);
    utimesSync(filePath, future, future);
    assert.equal(readProjectFile(id)?.org.slug, 'echo');
  });
});
