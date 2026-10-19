/// <mls fileReference="_102034_/l1/server/layer_1_external/config/messagesIntegration.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';

const TOKEN_A = 'sentinel-token-alpha-rt93';
const TOKEN_B = 'sentinel-token-bravo-rt93';
const TOKEN_ENV = 'sentinel-token-env-rt93';
const TOKEN_ROTATED = 'sentinel-token-rotated-rt93';
const TOKEN_BROKEN = 'sentinel-token-broken-json-rt93';

function withProjectFilesDir(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'msg-integration-'));
  const prevDir = process.env.CBE_PROJECT_FILES_DIR;
  const prevToken = process.env.MSG_PROXY_TOKEN;
  process.env.CBE_PROJECT_FILES_DIR = root;
  process.env.MSG_PROXY_TOKEN = TOKEN_ENV;
  try {
    fn(root);
  } finally {
    if (prevDir === undefined) delete process.env.CBE_PROJECT_FILES_DIR;
    else process.env.CBE_PROJECT_FILES_DIR = prevDir;
    if (prevToken === undefined) delete process.env.MSG_PROXY_TOKEN;
    else process.env.MSG_PROXY_TOKEN = prevToken;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeProjectFile(root: string, projectId: string, body: string | object): string {
  const filePath = join(root, `${projectId}.json`);
  writeFileSync(filePath, typeof body === 'string' ? body : JSON.stringify(body));
  return filePath;
}

function bumpMtime(filePath: string): void {
  const future = new Date(Date.now() + 5000);
  utimesSync(filePath, future, future);
}

function projectBody(projectId: string, orgId: string, token?: string, extra?: object): object {
  return {
    schema: 1,
    generatedAt: '2026-10-01T00:00:00.000Z',
    org: { orgId, slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      projectId,
      domain: null,
      appEnv: null,
      language: null,
      type: 'client',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
    ...(token === undefined ? {} : { collabMessages: { token } }),
    ...extra,
  };
}

function captureConsole(fn: () => void): string {
  const lines: string[] = [];
  const orig = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
  };
  const push = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  console.error = push as typeof console.error;
  console.warn = push as typeof console.warn;
  console.log = push as typeof console.log;
  console.info = push as typeof console.info;
  try {
    fn();
    return lines.join('\n');
  } finally {
    console.error = orig.error;
    console.warn = orig.warn;
    console.log = orig.log;
    console.info = orig.info;
  }
}

function expectNotConfigured(fn: () => void): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'MSG_APP_NOT_CONFIGURED');
    assert.equal(err.statusCode, 503);
    assert.equal(err.cause, undefined);
    const dumped = `${err.name} ${err.message} ${err.code} ${JSON.stringify(err.details ?? null)}`;
    for (const secret of [TOKEN_A, TOKEN_B, TOKEN_ENV, TOKEN_ROTATED, TOKEN_BROKEN]) {
      assert.equal(dumped.includes(secret), false);
    }
    return true;
  });
}

test('two applications return their own org and token, never the env token', () => {
  withProjectFilesDir((root) => {
    writeProjectFile(root, '310001', projectBody('310001', 'org-a', TOKEN_A));
    writeProjectFile(root, '310002', projectBody('310002', 'org-b', TOKEN_B));
    const a = readMessagesIntegration('310001');
    const b = readMessagesIntegration('310002');
    assert.deepEqual(a, { projectId: '310001', organizationId: 'org-a', token: TOKEN_A });
    assert.deepEqual(b, { projectId: '310002', organizationId: 'org-b', token: TOKEN_B });
    assert.equal(Object.isFrozen(a), true);
    assert.equal(JSON.stringify(a).includes('slug'), false);
  });
});

test('invalid project ids are scope errors and do not read a credential', () => {
  withProjectFilesDir((root) => {
    writeProjectFile(root, '310001', projectBody('310001', 'org-a', TOKEN_A));
    for (const id of ['', '0', '01', '1.5', '-1', 'abc', ' 310001', '310001 ', String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(() => readMessagesIntegration(id), (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'MSG_APP_SCOPE_INVALID');
        assert.equal(err.statusCode, 400);
        assert.equal(err.cause, undefined);
        assert.equal(`${err.message}`.includes(TOKEN_A), false);
        return true;
      });
    }
  });
});

test('missing file, invalid JSON, bad block, foreign project and empty org fail closed', () => {
  withProjectFilesDir((root) => {
    const noise = captureConsole(() => {
      expectNotConfigured(() => readMessagesIntegration('310010'));

      writeProjectFile(root, '310011', `{"collabMessages":{"token":"${TOKEN_BROKEN}"}}`);
      expectNotConfigured(() => readMessagesIntegration('310011'));
      expectNotConfigured(() => readMessagesIntegration('310011'));

      writeProjectFile(root, '310012', projectBody('310012', 'org-a'));
      expectNotConfigured(() => readMessagesIntegration('310012'));

      writeProjectFile(root, '310013', projectBody('310013', 'org-a', TOKEN_A, { collabMessages: ['nope'] }));
      expectNotConfigured(() => readMessagesIntegration('310013'));

      writeProjectFile(root, '310014', projectBody('310014', 'org-a', TOKEN_A, { collabMessages: { token: 1 } }));
      expectNotConfigured(() => readMessagesIntegration('310014'));

      writeProjectFile(root, '310015', projectBody('310015', 'org-a', ''));
      expectNotConfigured(() => readMessagesIntegration('310015'));

      writeProjectFile(root, '310016', projectBody('310016', 'org-a', ` ${TOKEN_A}`));
      expectNotConfigured(() => readMessagesIntegration('310016'));

      writeProjectFile(root, '310017', projectBody('310017', 'org-a', `${TOKEN_A}\n`));
      expectNotConfigured(() => readMessagesIntegration('310017'));

      writeProjectFile(root, '310018', projectBody('999999', 'org-a', TOKEN_A));
      expectNotConfigured(() => readMessagesIntegration('310018'));

      writeProjectFile(root, '310019', projectBody('310019', '', TOKEN_A));
      expectNotConfigured(() => readMessagesIntegration('310019'));
    });
    for (const secret of [TOKEN_A, TOKEN_B, TOKEN_ENV, TOKEN_BROKEN]) {
      assert.equal(noise.includes(secret), false, 'console echoed a fixture token');
    }
  });
});

test('a later mtime is re-read and removal does not keep the previous token', () => {
  withProjectFilesDir((root) => {
    const filePath = writeProjectFile(root, '310020', projectBody('310020', 'org-a', TOKEN_A));
    assert.equal(readMessagesIntegration('310020').token, TOKEN_A);

    writeProjectFile(root, '310020', projectBody('310020', 'org-a', TOKEN_ROTATED));
    bumpMtime(filePath);
    assert.equal(readMessagesIntegration('310020').token, TOKEN_ROTATED);
    assert.equal(readMessagesIntegration('310020').token === TOKEN_ENV, false);

    rmSync(filePath);
    const noise = captureConsole(() => {
      expectNotConfigured(() => readMessagesIntegration('310020'));
    });
    assert.equal(noise.includes(TOKEN_A), false);
    assert.equal(noise.includes(TOKEN_ROTATED), false);
    assert.equal(noise.includes(TOKEN_ENV), false);
  });
});
