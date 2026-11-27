/// <mls fileReference="_102034_/l1/server/layer_1_external/config/envProjectDomain.test.ts" enhancement="_blank" />
// rt327: the domain of the app. The variable first; without it, `project.domain` of the project file the sites writes; without both, undefined.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

const KEYS = ['PROJECT_DOMAIN', 'DOMAIN', 'PROJECT_DOMAIN_DEVELOPMENT', 'DOMAIN_DEVELOPMENT', 'PROJECT_ID', 'COLLAB_PROJECT_ID', 'PROJECT_ID_DEVELOPMENT', 'COLLAB_PROJECT_ID_DEVELOPMENT', 'CBE_PROJECT_FILES_DIR'];
const saved = new Map<string, string | undefined>();
let dir = '';

before(() => {
  for (const key of KEYS) saved.set(key, process.env[key]);
  dir = mkdtempSync(path.join(tmpdir(), 'env-domain-'));
});

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

after(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

function projectFile(id: string, domain: string): void {
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    schema: 1,
    generatedAt: '2026-11-27T12:00:00.000Z',
    org: { orgId: 'org-1', slug: 'org', name: 'Org', createdAt: '2026-11-27T12:00:00.000Z' },
    project: { domain, projectId: id, appEnv: null, language: null, type: 'client', createdAt: '2026-11-27T12:00:00.000Z' },
  }));
}

describe('rt327: projectDomain', () => {
  it('the variable wins over the project file', () => {
    projectFile('900401', 'from-file.example.com');
    process.env.CBE_PROJECT_FILES_DIR = dir;
    process.env.COLLAB_PROJECT_ID = '900401';
    process.env.PROJECT_DOMAIN = 'from-env.example.com';
    assert.equal(readAppEnv().projectDomain, 'from-env.example.com');
  });

  it('without the variable it is the domain of the project file of the project, and it says so once', () => {
    projectFile('900402', '900402.example.com');
    process.env.CBE_PROJECT_FILES_DIR = dir;
    process.env.COLLAB_PROJECT_ID = '900402';
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
      assert.equal(readAppEnv().projectDomain, '900402.example.com');
      assert.equal(readAppEnv().projectDomain, '900402.example.com');
    } finally {
      console.info = original;
    }
    assert.ok(lines.filter((line) => line.includes('[env] project domain from the project file (900402.example.com)')).length <= 1, 'logged at most once per process');
  });

  it('PROJECT_ID is read too, and DOMAIN is a variable like PROJECT_DOMAIN', () => {
    projectFile('900403', '900403.example.com');
    process.env.CBE_PROJECT_FILES_DIR = dir;
    process.env.PROJECT_ID = '900403';
    assert.equal(readAppEnv().projectDomain, '900403.example.com');
    process.env.DOMAIN = 'plain.example.com';
    assert.equal(readAppEnv().projectDomain, 'plain.example.com');
  });

  it('no variable and no file (a local run), or no project id, or an id that is not a number: undefined, as before', () => {
    process.env.CBE_PROJECT_FILES_DIR = dir;
    process.env.COLLAB_PROJECT_ID = '900499';
    assert.equal(readAppEnv().projectDomain, undefined, 'no file for that project');
    delete process.env.COLLAB_PROJECT_ID;
    assert.equal(readAppEnv().projectDomain, undefined, 'no project id');
    process.env.COLLAB_PROJECT_ID = '../900402';
    assert.equal(readAppEnv().projectDomain, undefined, 'not an id');
  });
});
