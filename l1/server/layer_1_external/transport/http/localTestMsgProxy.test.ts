/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/localTestMsgProxy.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import { setLocalTestConfigLoaderForTests, mintLocalTestCookie } from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';
import type { LocalTestConfig } from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import {
  registerMsgProxy,
  setLocalTestProxyConfigLoaderForTests,
} from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';

const TOKEN = 'rt86-service-token-must-not-leak';
const DEV_USER = 'user-desenv';
const PROJECT = '102047';
const ORG = `runtime-test:${PROJECT}`;
const HOST = '127.0.0.1:2047';
const ORIGIN = `http://${HOST}`;

const ENV_KEYS = ['MSG_PROXY_TARGET', 'MSG_PROXY_TOKEN', 'MSG_PROXY_USER_ID', 'MSG_PROXY_ORG_ID'] as const;
const savedEnv = new Map<string, string | undefined>();

interface Hit {
  url: string;
  authorization: string;
  userId: string;
  orgId: string;
  cookie: string;
  body: string;
}

function persona(alias: 'responsavel' | 'membro', cmUserId: string): LocalTestConfig['personas']['responsavel'] {
  return {
    alias,
    email: `${alias}@bench.test`,
    name: alias,
    sub: `sub-${alias}`,
    personMdmId: `mdm-${alias}`,
    cmUserId,
  };
}

function config(cmTarget: string): LocalTestConfig {
  return {
    enabled: true,
    projectId: PROJECT,
    organizationKey: 'org-key',
    companyMdmId: 'company-1',
    cmOrgId: ORG,
    cmTarget,
    storagePrefix: 'desenv_',
    allowedOrigins: [ORIGIN],
    cookieKey: '0123456789abcdef0123456789abcdef',
    personas: {
      responsavel: persona('responsavel', 'cm-responsavel'),
      membro: persona('membro', 'cm-membro'),
    },
  };
}

function cookieFor(alias: 'responsavel' | 'membro', state: LocalTestConfig): string {
  return `collab_local_test_${PROJECT}=${mintLocalTestCookie(alias, state)}`;
}

async function listenUpstream(): Promise<{ url: string; hits: Hit[]; close: () => Promise<void> }> {
  const hits: Hit[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const userId = String(req.headers['x-user-id'] ?? '');
      const hit: Hit = {
        url: req.url ?? '',
        authorization: String(req.headers.authorization ?? ''),
        userId,
        orgId: String(req.headers['x-org-id'] ?? ''),
        cookie: String(req.headers.cookie ?? ''),
        body: Buffer.concat(chunks).toString('utf8'),
      };
      hits.push(hit);
      const payload = req.url === '/whoami'
        ? { statusCode: 200, cmUserId: userId }
        : { statusCode: 200, echoed: userId };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('upstream address missing');
  return {
    url: `http://127.0.0.1:${address.port}`,
    hits,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test('local bench proxy separates two cookies and refuses a forged body', async (t) => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  const upstream = await listenUpstream();
  const state = config(upstream.url);
  process.env.MSG_PROXY_TARGET = upstream.url;
  process.env.MSG_PROXY_TOKEN = TOKEN;
  process.env.MSG_PROXY_USER_ID = DEV_USER;
  process.env.MSG_PROXY_ORG_ID = 'org-desenv';
  const load = () => state;
  setLocalTestConfigLoaderForTests(load);
  setLocalTestProxyConfigLoaderForTests(load);

  const app = Fastify();
  registerMsgProxy(app);
  const realEnv = process.env;
  process.env = new Proxy(realEnv, {
    ownKeys() {
      throw new Error('process.env ownKeys refused');
    },
  });
  t.after(async () => {
    process.env = realEnv;
    setLocalTestConfigLoaderForTests();
    setLocalTestProxyConfigLoaderForTests();
    for (const key of ENV_KEYS) {
      const previous = savedEnv.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    await app.close();
    await upstream.close();
  });

  const headersOf = (alias: 'responsavel' | 'membro', extra: Record<string, string> = {}) => ({
    host: HOST,
    origin: ORIGIN,
    cookie: cookieFor(alias, state),
    'content-type': 'application/json',
    ...extra,
  });

  const [responsavel, membro] = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/msg',
      headers: headersOf('responsavel', { 'x-user-id': 'cm-membro', 'x-org-id': 'other-org' }),
      payload: { action: 'getUserUpdate', userId: 'cm-responsavel' },
    }),
    app.inject({
      method: 'POST',
      url: '/msg',
      headers: headersOf('membro'),
      payload: { action: 'getUserUpdate', userId: '' },
    }),
  ]);
  assert.equal(responsavel.statusCode, 200);
  assert.equal(membro.statusCode, 200);
  assert.equal(responsavel.json().echoed, 'cm-responsavel');
  assert.equal(membro.json().echoed, 'cm-membro');
  assert.equal(JSON.stringify(responsavel.json()).includes(TOKEN), false);

  const byUser = new Map(upstream.hits.map((hit) => [hit.userId, hit]));
  const left = byUser.get('cm-responsavel');
  const right = byUser.get('cm-membro');
  assert.ok(left && right);
  assert.equal(left.authorization, `Bearer ${TOKEN}`);
  assert.equal(right.authorization, `Bearer ${TOKEN}`);
  assert.equal(left.orgId, ORG);
  assert.equal(right.orgId, ORG);
  assert.equal(left.cookie.includes('collab_local_test_'), false);
  assert.equal(right.cookie.includes('collab_local_test_'), false);
  assert.equal(JSON.parse(left.body).userId, 'cm-responsavel');
  assert.equal(JSON.parse(right.body).userId, '');
  assert.equal(upstream.hits.some((hit) => hit.userId === DEV_USER), false);

  const whoami = await app.inject({
    method: 'GET',
    url: '/whoami',
    headers: headersOf('responsavel'),
  });
  assert.equal(whoami.statusCode, 200);
  assert.equal(whoami.json().cmUserId, 'cm-responsavel');
  assert.equal(JSON.stringify(whoami.json()).includes(TOKEN), false);

  const forged = await app.inject({
    method: 'POST',
    url: '/msg',
    headers: headersOf('responsavel', { 'x-user-id': 'cm-membro' }),
    payload: { action: 'addMessage', userId: 'cm-membro' },
  });
  assert.equal(forged.statusCode, 403);
  const beforeRefuse = upstream.hits.length;

  const missing = await app.inject({ method: 'POST', url: '/msg', headers: { host: HOST, origin: ORIGIN }, payload: {} });
  assert.equal(missing.statusCode, 401);

  const invalid = await app.inject({
    method: 'POST',
    url: '/msg',
    headers: { host: HOST, origin: ORIGIN, cookie: `collab_local_test_${PROJECT}=aaaa.bbbb` },
    payload: { userId: 'cm-responsavel' },
  });
  assert.equal(invalid.statusCode, 401);

  const realCredential = await app.inject({
    method: 'POST',
    url: '/msg',
    headers: headersOf('responsavel', { authorization: 'Bearer browser-token' }),
    payload: { userId: 'cm-responsavel' },
  });
  assert.equal(realCredential.statusCode, 401);
  assert.equal(upstream.hits.length, beforeRefuse);

  const mdmAsUser = await app.inject({
    method: 'POST',
    url: '/msg',
    headers: headersOf('responsavel'),
    payload: { userId: 'mdm-responsavel' },
  });
  assert.equal(mdmAsUser.statusCode, 403);
  assert.equal(upstream.hits.length, beforeRefuse);

  setLocalTestConfigLoaderForTests(() => ({ enabled: false }));
  setLocalTestProxyConfigLoaderForTests(() => ({ enabled: false }));
  const disabledHits = upstream.hits.length;
  const disabled = await app.inject({
    method: 'POST',
    url: '/msg',
    headers: {
      host: HOST,
      cookie: cookieFor('membro', state),
      'x-user-id': 'cm-membro',
      'content-type': 'application/json',
    },
    payload: { userId: 'cm-membro' },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(upstream.hits.length, disabledHits + 1);
  assert.equal(upstream.hits.at(-1)?.userId, DEV_USER);
  assert.equal(upstream.hits.at(-1)?.orgId, 'org-desenv');
});
