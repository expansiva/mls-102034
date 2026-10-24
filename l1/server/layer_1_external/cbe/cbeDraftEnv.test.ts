/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeDraftEnv.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildDenoArgs } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';

const SLUG = 'rt130-env';
const PROJECT_ID = '102047';
const DATABASE_URL = 'postgres://127.0.0.1:5432/collab_app_draft_rt130_env';
const FIXTURE_TOKEN = 'rt130-fixture-token';

const here = dirname(fileURLToPath(import.meta.url));
const mlsBase = join(here, '..', '..', '..', '..', '..');

interface DraftDenoConfigModule {
  buildDraftDenoConfig(input: { base: string; slug: string; clientProjectId: number }): Record<string, unknown>;
}

/** The official generator is a plain `.mjs`; a computed path keeps tsc from demanding a declaration file. */
async function loadDraftDenoConfigModule(): Promise<DraftDenoConfigModule> {
  const file = join(mlsBase, 'scripts', 'runtime', 'denoDraftConfig.mjs');
  return await import(pathToFileURL(file).href) as DraftDenoConfigModule;
}

function denoArgs(entry: string, configPath: string): string[] {
  const args = buildDenoArgs(mlsBase, SLUG, 4100, DATABASE_URL);
  const allowEnv = args.find((arg) => arg.startsWith('--allow-env='));
  assert.ok(allowEnv);
  assert.equal(allowEnv.includes('DATABASE_URL,'), false);
  assert.equal(allowEnv.endsWith(',DATABASE_URL'), false);
  assert.equal(allowEnv.includes('DATABASE_URL_TEST'), true);
  const configAt = args.indexOf('--config');
  assert.ok(configAt > 0);
  args[configAt + 1] = configPath;
  args[args.length - 1] = entry;
  args.splice(configAt, 0, '--no-prompt');
  return args;
}

function denoBin(): string {
  const found = spawnSync('/usr/bin/which', ['deno'], { encoding: 'utf8' });
  const bin = (found.stdout ?? '').trim();
  if (found.status !== 0 || !bin) {
    throw new Error(`deno unavailable: ${(found.stderr ?? '').trim() || 'not on PATH'}`);
  }
  return bin;
}

function runDeno(
  entry: string,
  configPath: string,
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(denoBin(), denoArgs(entry, configPath), {
    cwd: dirname(entry),
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      MSG_PROXY_TOKEN: FIXTURE_TOKEN,
      ...extraEnv,
    },
    timeout: 120_000,
  });
  const detail = [child.stderr, child.stdout, child.error?.message, child.signal].filter(Boolean).join('\n');
  if (child.error) {
    throw new Error(detail);
  }
  return {
    status: child.status,
    stdout: child.stdout ?? '',
    stderr: detail,
  };
}

const ENTRY = `
const globalEnv = await Deno.permissions.query({ name: 'env' });
const databaseUrl = await Deno.permissions.query({ name: 'env', variable: 'DATABASE_URL' });
const named = await Deno.permissions.query({ name: 'env', variable: 'MSG_PROXY_TOKEN' });
let databaseRead = 'granted';
try {
  Deno.env.get('DATABASE_URL');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  databaseRead = message.includes('NotCapable') || message.includes('Requires env access') ? 'denied' : 'other';
}
const report = {
  global: globalEnv.state,
  databaseUrl: databaseUrl.state,
  databaseRead,
  named: named.state,
};

const { createRuntimeMessagesTaskPort } = await import('/_102034_/l1/workflow/messagesRuntime.js');
createRuntimeMessagesTaskPort({ projectId: ${JSON.stringify(PROJECT_ID)}, moduleId: 'rt130' });
report.client = 'ok';

const os = await import('node:os');
os.loadavg();
os.freemem();
os.totalmem();
os.cpus();
report.sys = 'ok';

const { createServer } = await import('node:http');
const { once } = await import('node:events');
const hits = [];
const upstream = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const userId = String(req.headers['x-user-id'] ?? '');
    hits.push({
      authorization: String(req.headers.authorization ?? ''),
      userId,
      orgId: String(req.headers['x-org-id'] ?? ''),
      cookie: String(req.headers.cookie ?? ''),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 200, echoed: userId }));
  });
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('upstream address missing');
const target = 'http://127.0.0.1:' + address.port;
Deno.env.set('MSG_PROXY_TARGET', target);

const { mintLocalTestCookie, setLocalTestConfigLoaderForTests } = await import('/_102034_/l1/server/layer_1_external/auth/localTestSession.js');
const { registerMsgProxy, setLocalTestProxyConfigLoaderForTests } = await import('/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js');
const Fastify = (await import('fastify')).default;
const projectId = ${JSON.stringify(PROJECT_ID)};
const orgId = 'runtime-test:' + projectId;
const state = {
  enabled: true,
  projectId,
  organizationKey: 'org-key',
  companyMdmId: 'company-1',
  cmOrgId: orgId,
  cmTarget: target,
  storagePrefix: 'desenv_',
  allowedOrigins: ['http://127.0.0.1:2047'],
  cookieKey: '0123456789abcdef0123456789abcdef',
  personas: {
    responsavel: {
      alias: 'responsavel',
      email: 'responsavel@bench.test',
      name: 'responsavel',
      sub: 'sub-responsavel',
      personMdmId: 'mdm-responsavel',
      cmUserId: 'cm-responsavel',
    },
    membro: {
      alias: 'membro',
      email: 'membro@bench.test',
      name: 'membro',
      sub: 'sub-membro',
      personMdmId: 'mdm-membro',
      cmUserId: 'cm-membro',
    },
  },
};
const load = () => state;
setLocalTestConfigLoaderForTests(load);
setLocalTestProxyConfigLoaderForTests(load);
const app = Fastify({ logger: false });
registerMsgProxy(app);
const cookie = 'collab_local_test_' + projectId + '=' + mintLocalTestCookie('responsavel', state);
const response = await app.inject({
  method: 'POST',
  url: '/msg',
  headers: {
    host: '127.0.0.1:2047',
    origin: 'http://127.0.0.1:2047',
    cookie,
    'content-type': 'application/json',
  },
  payload: { action: 'getUserUpdate', userId: 'cm-responsavel' },
});
const hit = hits[0];
const token = Deno.env.get('MSG_PROXY_TOKEN');
report.persona = response.statusCode;
report.user = hit && hit.userId === 'cm-responsavel';
report.org = hit && hit.orgId === orgId;
report.auth = Boolean(hit && token && hit.authorization === 'Bearer ' + token);
report.cookieStripped = Boolean(hit && !hit.cookie.includes('collab_local_test_'));
await app.close();
upstream.close();
console.log('RT130 ' + JSON.stringify(report));
`;

const ENUM_ENTRY = `
try {
  Object.keys(process.env);
  console.log('RT130 enum-open');
  Deno.exit(1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('NotCapable') || message.includes('Requires env access')) {
    console.log('RT130 enum-denied');
    Deno.exit(0);
  }
  console.log('RT130 enum-other');
  Deno.exit(2);
}
`;

const LOCAL_CLAIMS = {
  sub: 'sub-responsavel',
  email: 'responsavel@bench.test',
  name: 'responsavel',
};
const JWT_CLAIMS = {
  sub: 'auth-user-9f3a',
  email: 'ana@example.com',
  name: 'Ana',
  iss: 'https://auth.collab.codes',
  authorities: ['sites:admin'],
  active_org: {
    id: 'org-1',
    teams: [{ id: 'team-1', name: 'ops', roles: ['comandaRestaurante:garcom'] }],
  },
};
const IDENTITY_SECRET = 'rt131-draft-identity-secret';

function encodeClaims(claims: object): string {
  return Buffer.from(JSON.stringify(claims)).toString('base64url');
}

const RT131_ENTRY = `
const { handleHttpRequest } = await import('/_102034_/l1/server/layer_1_external/transport/http/startServer.ts');
const body = { routine: 'rt131.probe.ping', meta: { userId: 'forged-client', actorId: 'forged-client' } };
const localClaims = ${JSON.stringify(encodeClaims(LOCAL_CLAIMS))};
const jwtClaims = ${JSON.stringify(encodeClaims(JWT_CLAIMS))};
const secret = ${JSON.stringify(IDENTITY_SECRET)};
async function call(label, headers) {
  const result = await handleHttpRequest('POST', '/execBff', body, undefined, headers);
  const error = result.body && result.body.error;
  console.log('RT131 ' + JSON.stringify({
    label,
    statusCode: result.statusCode,
    code: error && error.code ? error.code : null,
  }));
}
await call('anon', {});
await call('forged', {
  'x-collab-draft-identity-secret': 'forged-secret',
  'x-collab-draft-identity': localClaims,
});
await call('local', {
  'x-collab-draft-identity-secret': secret,
  'x-collab-draft-identity': localClaims,
});
await call('jwt', {
  'x-collab-draft-identity-secret': secret,
  'x-collab-draft-identity': jwtClaims,
});
`;

const EXEC_SPY = `
export { applyVerifiedEmailToSession, createDefaultRequestContext, createRequestContext, createSessionContext, readOrganizationContext, trustedIdentityClaims, withAlphaAuthorities } from ${JSON.stringify(pathToFileURL(join(mlsBase, 'mls-102034/l1/server/layer_2_controllers/execBff.ts')).href)};
export async function execBff(request) {
  const meta = request && request.meta ? request.meta : {};
  console.log('RT131 exec ' + JSON.stringify({
    verifiedUserId: meta.verifiedUserId ?? null,
    verifiedEmail: meta.verifiedEmail ?? null,
  }));
  return { statusCode: 200, response: { ok: true, data: null, error: null } };
}
`;

test('draft deno flags deny global env and still run message paths', async () => {
  const { buildDraftDenoConfig } = await loadDraftDenoConfigModule();
  const draftDir = join(mlsBase, 'drafts', SLUG);
  mkdirSync(draftDir, { recursive: true });
  const configPath = join(draftDir, 'deno.json');
  const entry = join(draftDir, 'fixture.ts');
  const enumEntry = join(draftDir, 'enumEnv.ts');
  writeFileSync(configPath, `${JSON.stringify(buildDraftDenoConfig({
    base: mlsBase,
    slug: SLUG,
    clientProjectId: 102047,
  }), null, 2)}\n`);
  writeFileSync(entry, ENTRY);
  writeFileSync(enumEntry, ENUM_ENTRY);
  try {
    const probed = denoArgs(entry, configPath).find((arg) => arg.startsWith('--allow-env='));
    const fresh = buildDenoArgs(mlsBase, SLUG, 4100, DATABASE_URL).find((arg) => arg.startsWith('--allow-env='));
    assert.equal(probed, fresh);

    const negative = runDeno(enumEntry, configPath);
    assert.equal(negative.status, 0, negative.stderr || negative.stdout);
    assert.match(negative.stdout, /RT130 enum-denied/);
    assert.equal(negative.stdout.includes('MSG_PROXY_TOKEN='), false);

    const result = runDeno(entry, configPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split('\n').find((item) => item.startsWith('RT130 '));
    assert.ok(line, result.stdout + result.stderr);
    const report = JSON.parse(line.slice('RT130 '.length)) as {
      global: string;
      databaseUrl: string;
      databaseRead: string;
      named: string;
      client: string;
      sys: string;
      persona: number;
      user: boolean;
      org: boolean;
      auth: boolean;
      cookieStripped: boolean;
    };
    assert.notEqual(report.global, 'granted');
    assert.notEqual(report.databaseUrl, 'granted');
    assert.equal(report.databaseRead, 'denied');
    assert.equal(report.named, 'granted');
    assert.equal(report.client, 'ok');
    assert.equal(report.sys, 'ok');
    assert.equal(report.persona, 200);
    assert.equal(report.user, true);
    assert.equal(report.org, true);
    assert.equal(report.auth, true);
    assert.equal(report.cookieStripped, true);
    assert.equal(result.stdout.includes(FIXTURE_TOKEN), false);
    assert.equal(result.stderr.includes(FIXTURE_TOKEN), false);
  } finally {
    rmSync(draftDir, { recursive: true, force: true });
  }
});

test('draft process takes only the identity the parent already verified', async () => {
  const { buildDraftDenoConfig } = await loadDraftDenoConfigModule();
  const draftDir = join(mlsBase, 'drafts', 'rt131-identity');
  mkdirSync(draftDir, { recursive: true });
  const configPath = join(draftDir, 'deno.json');
  const entry = join(draftDir, 'rt131Identity.ts');
  const spy = join(draftDir, 'execBffSpy.ts');
  const config = buildDraftDenoConfig({
    base: mlsBase,
    slug: SLUG,
    clientProjectId: 102047,
  });
  const imports = config.imports as Record<string, string>;
  imports['/_102034_/l1/server/layer_2_controllers/execBff.js'] = pathToFileURL(spy).href;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(entry, RT131_ENTRY);
  writeFileSync(spy, EXEC_SPY);
  try {
    const result = runDeno(entry, configPath, {
      APP_ENV: 'development',
      PORT: '4100',
      RUNTIME_MODE: 'postgres',
      DATABASE_URL_TEST: DATABASE_URL,
      COLLAB_DRAFT: SLUG,
      COLLAB_PROJECT_ID: PROJECT_ID,
      COLLAB_DRAFT_IDENTITY_SECRET: IDENTITY_SECRET,
      CBE_PROJECTS_DIR: mlsBase,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(IDENTITY_SECRET), false);
    assert.equal(result.stderr.includes(IDENTITY_SECRET), false);
    const calls = result.stdout.split('\n')
      .filter((item) => item.startsWith('RT131 {'))
      .map((item) => JSON.parse(item.slice('RT131 '.length)) as { label: string; statusCode: number; code: string | null });
    const execs = result.stdout.split('\n')
      .filter((item) => item.startsWith('RT131 exec '))
      .map((item) => JSON.parse(item.slice('RT131 exec '.length)) as { verifiedUserId: string | null; verifiedEmail: string | null });
    const byLabel = Object.fromEntries(calls.map((item) => [item.label, item]));
    assert.match(result.stderr, /unauthenticated call \(missing-token\)/);
    assert.equal(byLabel.anon.statusCode, 200);
    assert.equal(byLabel.anon.code, null);
    assert.equal(byLabel.forged.statusCode, 401);
    assert.equal(byLabel.forged.code, 'UNAUTHENTICATED');
    assert.equal(byLabel.local.statusCode, 200);
    assert.equal(byLabel.jwt.statusCode, 200);
    assert.deepEqual(execs, [
      { verifiedUserId: null, verifiedEmail: null },
      { verifiedUserId: LOCAL_CLAIMS.sub, verifiedEmail: LOCAL_CLAIMS.email },
      { verifiedUserId: JWT_CLAIMS.sub, verifiedEmail: JWT_CLAIMS.email },
    ]);
  } finally {
    rmSync(draftDir, { recursive: true, force: true });
  }
});
