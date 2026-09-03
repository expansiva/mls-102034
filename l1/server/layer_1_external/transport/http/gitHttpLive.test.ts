/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/gitHttpLive.test.ts" enhancement="_blank" />
// A prova ponta a ponta da porta git: um Fastify de verdade, o `git` de verdade, um clone e um push
// de verdade. Nada de simular o protocolo — é justamente o protocolo que a gente não implementou (o
// `git http-backend` implementa), então um teste que o imitasse não provaria nada.
//
// O verificador de token é o único stub, e por isso ele entra por parâmetro: assinar um JWT de
// verdade exigiria a JWKS do collab-auth, que é o que o teste NÃO deve depender.

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerGitRoutes, type GitTokenVerifier } from '/_102034_/l1/server/layer_1_external/transport/http/gitHttp.js';

const PROJECT_ID = '999001';

/**
 * Tokens com FORMA de JWT, e não strings quaisquer.
 *
 * O credential helper (gb53) lê o `exp` do token para decidir se renova antes de entregá-lo. Um
 * token de fixture sem `exp` faria o helper concluir "expirado" e o teste falharia por um motivo que
 * não existe em produção — o collab-auth sempre emite JWT com exp.
 */
function fixtureJwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })}.assinatura`;
}

const GOOD_TOKEN = fixtureJwt({ sub: 'user-1', email: 'wagner@collab.codes' });
const OTHER_TOKEN = fixtureJwt({ sub: 'user-2', email: 'outra@collab.codes' });
const EMAIL = 'wagner@collab.codes';
const OTHER_EMAIL = 'outra@collab.codes';
/** A raiz do mls-base, para achar o credential helper de verdade (scripts/publishGitCredential.mjs). */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');

const SERVICE_TOKEN = fixtureJwt({ sub: 'service:key-1', service: true });
const SERVICE_PREFIX = 'cak_ab12cd34';

const verify: GitTokenVerifier = async (token) => {
  if (token === GOOD_TOKEN) return { sub: 'user-1', email: EMAIL };
  if (token === OTHER_TOKEN) return { sub: 'user-2', email: OTHER_EMAIL };
  // O que o `POST /auth/token/exchange` do collab-auth emite (gb53).
  if (token === SERVICE_TOKEN) {
    return {
      sub: 'service:key-1',
      email: `service+${SERVICE_PREFIX}@service.collab.codes`,
      service: true,
      key_prefix: SERVICE_PREFIX,
    };
  }
  throw new Error('assinatura inválida');
};

/**
 * git rodado de forma ASSÍNCRONA, e isto não é estilo: o servidor Fastify vive NESTE processo, então um
 * `spawnSync` congelaria o event loop e o servidor nunca responderia — o clone dava timeout e parecia
 * bug da rota. Foi exatamente o que aconteceu na primeira versão deste teste.
 *
 * Os `-c` isolam o git do config do usuário: um credential helper global do dev não pode entrar aqui.
 */
function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const child = spawn('git', [
      '-c', 'user.name=Teste', '-c', 'user.email=teste@collab.codes',
      '-c', 'credential.helper=',
      ...args,
    ], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.on('error', (error) => done({ code: 1, out: `${out}${error.message}` }));
    child.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

interface Fixture { root: string; repo: string; app: FastifyInstance; port: number }

async function setup(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'collab-git-http-'));
  const repo = join(root, `mls-${PROJECT_ID}`);
  await git(root, ['init', '-b', 'main', `mls-${PROJECT_ID}`]);
  // updateInstead: é como os repos da VM nascem (gitReposSetup/projectInit) — o push atualiza a
  // worktree, que é de onde o build lê.
  await git(repo, ['config', 'receive.denyCurrentBranch', 'updateInstead']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'base']);

  process.env.COLLAB_GIT_PROJECT_ROOT = root;
  delete process.env.COLLAB_GIT_HTTP_ENABLED;
  const app = Fastify({ logger: false });
  registerGitRoutes(app, verify);
  // A rota catch-all existe no servidor real e vem DEPOIS: se o /git/* não ganhasse a disputa, um
  // clone receberia a casca do SPA com HTTP 200 — a falha mais confusa possível.
  app.get('/*', async () => 'shell do app');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { root, repo, app, port };
}

function urlWith(port: number, token: string, project = PROJECT_ID): string {
  return `http://collab:${token}@127.0.0.1:${port}/git/mls-${project}.git`;
}

test('sem token ⇒ 401 com WWW-Authenticate (sem ele o git nunca chama o credential helper)', async () => {
  const fx = await setup();
  try {
    const response = await fetch(`http://127.0.0.1:${fx.port}/git/mls-${PROJECT_ID}.git/info/refs?service=git-upload-pack`);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic realm=/u);
  } finally {
    await fx.app.close();
  }
});

test('token inválido ⇒ 401, e a razão NÃO vai para o cliente', async () => {
  const fx = await setup();
  try {
    const response = await fetch(
      `http://127.0.0.1:${fx.port}/git/mls-${PROJECT_ID}.git/info/refs?service=git-upload-pack`,
      { headers: { authorization: 'Bearer token-ruim' } },
    );
    assert.equal(response.status, 401);
    const body = await response.text();
    // "assinatura inválida" é diagnóstico de servidor: dizer ao anônimo QUAL foi o problema conta
    // se um token existe e apenas expirou.
    assert.equal(body.includes('assinatura'), false);
  } finally {
    await fx.app.close();
  }
});

test('projeto que não está nesta VM ⇒ 404, e nunca a casca do SPA', async () => {
  const fx = await setup();
  try {
    const response = await fetch(
      `http://127.0.0.1:${fx.port}/git/mls-888888.git/info/refs?service=git-upload-pack`,
      { headers: { authorization: `Bearer ${GOOD_TOKEN}` } },
    );
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes('shell do app'), false);
  } finally {
    await fx.app.close();
  }
});

test('com token ⇒ /info/refs é o anúncio smart do git, com o pkt-line do serviço', async () => {
  const fx = await setup();
  try {
    const response = await fetch(
      `http://127.0.0.1:${fx.port}/git/mls-${PROJECT_ID}.git/info/refs?service=git-upload-pack`,
      { headers: { authorization: `Bearer ${GOOD_TOKEN}` } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/x-git-upload-pack-advertisement');
    const body = await response.text();
    // O enquadramento pkt-line é do http-backend; o teste só confirma que não estamos servindo
    // outra coisa no lugar dele.
    assert.match(body, /^[0-9a-f]{4}# service=git-upload-pack/u);
    assert.match(body, /refs\/heads\/main/u);
  } finally {
    await fx.app.close();
  }
});

test('git clone de verdade pela porta https/http, com o token na senha do Basic', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone');
    const cloned = await git(fx.root, ['clone', urlWith(fx.port, GOOD_TOKEN), dest]);
    assert.equal(cloned.code, 0, cloned.out);
    assert.ok(existsSync(join(dest, 'README.md')), cloned.out);
    assert.equal(readFileSync(join(dest, 'README.md'), 'utf8'), 'base\n');
  } finally {
    await fx.app.close();
  }
});

test('git push de verdade: aceito, e a worktree do repo da VM avança (updateInstead)', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone-push');
    assert.equal((await git(fx.root, ['clone', urlWith(fx.port, GOOD_TOKEN), dest])).code, 0);
    writeFileSync(join(dest, 'novo.txt'), 'do push\n');
    await git(dest, ['add', '-A']);
    await git(dest, ['commit', '-m', 'push pela porta git']);
    const pushed = await git(dest, ['push', 'origin', 'main']);
    assert.equal(pushed.code, 0, pushed.out);
    // A prova de que o push chegou ao repo certo, e não a um bare paralelo.
    assert.ok(existsSync(join(fx.repo, 'novo.txt')), pushed.out);
    // E a prova de que o `http.receivepack` por env funcionou: sem ele o http-backend recusa TODO push.
    assert.equal((await git(fx.repo, ['log', '-1', '--format=%s'])).out.trim(), 'push pela porta git');
  } finally {
    await fx.app.close();
  }
});

test('push com token inválido ⇒ recusado, e nada entra no repo', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone-ruim');
    assert.equal((await git(fx.root, ['clone', urlWith(fx.port, GOOD_TOKEN), dest])).code, 0);
    writeFileSync(join(dest, 'nao-deve-entrar.txt'), 'x\n');
    await git(dest, ['add', '-A']);
    await git(dest, ['commit', '-m', 'sem autorização']);
    await git(dest, ['remote', 'set-url', 'origin', urlWith(fx.port, 'token-ruim')]);
    const pushed = await git(dest, ['push', 'origin', 'main']);
    assert.notEqual(pushed.code, 0);
    assert.equal(existsSync(join(fx.repo, 'nao-deve-entrar.txt')), false);
  } finally {
    await fx.app.close();
  }
});

test('o push log registra QUEM fez o quê, uma linha JSON por requisição', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone-log');
    assert.equal((await git(fx.root, ['clone', urlWith(fx.port, GOOD_TOKEN), dest])).code, 0);
    const logPath = join(fx.root, 'logs', 'git-push.jsonl');
    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(lines.length >= 2, `esperado info/refs + upload-pack, veio ${lines.length}`);
    assert.ok(lines.every((entry) => entry.email === EMAIL && entry.projectId === PROJECT_ID));
    assert.ok(lines.some((entry) => entry.endpoint === 'git-upload-pack' && entry.status === 200));
  } finally {
    await fx.app.close();
  }
});

test('COLLAB_GIT_HTTP_ENABLED=false fecha a porta inteira (a parada de emergência)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'collab-git-off-'));
  process.env.COLLAB_GIT_PROJECT_ROOT = root;
  process.env.COLLAB_GIT_HTTP_ENABLED = 'false';
  const app = Fastify({ logger: false });
  registerGitRoutes(app, verify);
  app.get('/*', async () => 'shell do app');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/git/mls-${PROJECT_ID}.git/info/refs?service=git-upload-pack`);
    // Com a rota ausente, sobra a catch-all — o que confirma que a rota some, não que ela nega.
    assert.equal(await response.text(), 'shell do app');
  } finally {
    await app.close();
    delete process.env.COLLAB_GIT_HTTP_ENABLED;
  }
});

test('dois desenvolvedores ⇒ dois registros distintos no push log (a auditoria da gb50)', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone-dois');
    assert.equal((await git(fx.root, ['clone', urlWith(fx.port, GOOD_TOKEN), dest])).code, 0);
    // O segundo token resolve para outra pessoa: é o verificador que decide a identidade, e o log
    // grava o que ele devolveu — não o que o cliente disse ser.
    await git(dest, ['remote', 'set-url', 'origin', urlWith(fx.port, OTHER_TOKEN)]);
    assert.equal((await git(dest, ['fetch', 'origin'])).code, 0);
    const lines = readFileSync(join(fx.root, 'logs', 'git-push.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line));
    const emails = new Set(lines.map((entry) => entry.email));
    assert.deepEqual([...emails].sort(), [EMAIL, OTHER_EMAIL].sort());
  } finally {
    await fx.app.close();
  }
});

test('clone com o credential helper do publishGit: sem token na URL, sem digitar nada', async () => {
  const fx = await setup();
  try {
    // A prova do caminho real: a URL NÃO tem credencial. Quem responde ao desafio 401 é o helper,
    // lendo o token que o `publishGit login` gravou na home.
    const home = mkdtempSync(join(tmpdir(), 'collab-home-'));
    writeFileSync(join(home, 'token.json'), JSON.stringify({ token: GOOD_TOKEN }));
    mkdirSync(join(home, '.collab'), { recursive: true });
    writeFileSync(join(home, '.collab', 'publishGit.json'), JSON.stringify({ token: GOOD_TOKEN }));
    const helper = join(REPO_ROOT, 'scripts', 'publishGitCredential.mjs');
    const dest = join(fx.root, 'clone-helper');
    const cloned = await git(fx.root, [
      '-c', `credential.helper=!${JSON.stringify(process.execPath)} ${JSON.stringify(helper)}`,
      'clone', `http://127.0.0.1:${fx.port}/git/mls-${PROJECT_ID}.git`, dest,
    ], { HOME: home });
    assert.equal(cloned.code, 0, cloned.out);
    assert.ok(existsSync(join(dest, 'README.md')), cloned.out);
  } finally {
    await fx.app.close();
  }
});

test('token de SERVIÇO (gb53) é aceito e o push log o mostra como máquina, não pessoa', async () => {
  const fx = await setup();
  try {
    const dest = join(fx.root, 'clone-servico');
    const cloned = await git(fx.root, ['clone', urlWith(fx.port, SERVICE_TOKEN), dest]);
    assert.equal(cloned.code, 0, cloned.out);
    const lines = readFileSync(join(fx.root, 'logs', 'git-push.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(lines.every((entry) => entry.actor === `service:${SERVICE_PREFIX}`), JSON.stringify(lines));
    // A pessoa continua aparecendo pelo e-mail: são duas formas distinguíveis no MESMO campo.
    assert.equal(lines[0].email, `service+${SERVICE_PREFIX}@service.collab.codes`);
  } finally {
    await fx.app.close();
  }
});
