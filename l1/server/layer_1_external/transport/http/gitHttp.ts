/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/gitHttp.ts" enhancement="_blank" />
// The git door of a VM: `git push https://<vm>/git/mls-<id>.git`, authenticated by a collab-auth JWT.
//
// WHY THIS EXISTS (gb50)
// A remote VM keeps port 22 closed, and SSM identifies the machine/IAM — not the person in the collab.
// So on a remote VM there was NO way for the team to clone or push at all. This route is that way, using
// what git already speaks: smart HTTP. The identity is the same JWT the app door already trusts, so
// "who published what" is answered before a single byte of the packfile arrives.
//
// SEMANTICS ARE NOT REIMPLEMENTED: the protocol is served by `git http-backend`, git's own CGI, spawned
// per request. That is deliberate — pkt-line framing of `/info/refs`, capability advertisement, the
// gzip `Content-Encoding` of a push, and the sideband multiplexing are all bug classes we do not own.
// What this file owns is the three things a CGI cannot decide: WHO is asking (JWT), WHICH repository
// they may touch, and WHAT gets recorded about it.
//
// ENFORCEMENT IS UNCONDITIONAL HERE, and that is a deliberate difference from `/execBff`.
// `isBffAuthEnforced()` (`BFF_JWT_ENABLED`, default false) exists because `/execBff` serves pages that
// are ALREADY published to real users: locking them out on a bad token would be worse than serving them.
// This route publishes nothing and serves nobody — it is a write door into the source of the VM. A door
// that opens when the identity check is merely "off" is not a door. No flag, no stage, no default-open.
//
// ATTRIBUTION comes for free from the CGI contract: `git http-backend` derives `GIT_COMMITTER_NAME` and
// `GIT_COMMITTER_EMAIL` from `REMOTE_USER`, so setting it to the verified e-mail makes git itself stamp
// the receiving side with the person who pushed. `COLLAB_PUSH_ACTOR_EMAIL` carries the same e-mail to
// the `post-receive` hook, which is the only place that can see the refs and the commit authors.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * O verificador entra por parâmetro, não por import.
 *
 * Duas razões, e a segunda é a que importa: (1) o transporte não precisa conhecer o collab-auth — quem
 * costura é o `startServer`, que já é o lugar onde as rotas são montadas; (2) sem o import com alias
 * `/_102034_/…` este arquivo é importável por um teste comum, e a prova ponta a ponta (clone e push de
 * verdade contra um Fastify de verdade) roda sem o runtime inteiro em pé. Um teste que não consegue
 * subir a rota real acaba testando uma cópia da rota, que é o modo de falha que a gente já pagou.
 */
export interface GitAuthClaims {
  sub?: unknown;
  email?: unknown;
  /** Machine, not person: a token minted from an API key (`POST /auth/token/exchange`, gb53). */
  service?: unknown;
  /** The non-secret prefix of the API key behind a service token. */
  key_prefix?: unknown;
}

/**
 * How the push log names who pushed.
 *
 * A service token carries an e-mail so that git has something to stamp, but that e-mail is a
 * machine's. The log must say so: automation showing up as a person is worse than no audit at all.
 */
export function actorOf(claims: GitAuthClaims): string {
  if (claims.service === true) {
    const prefix = typeof claims.key_prefix === 'string' && claims.key_prefix ? claims.key_prefix : 'unknown';
    return `service:${prefix}`;
  }
  return typeof claims.email === 'string' ? claims.email : '';
}

/** The only three endpoints of the smart protocol. The dumb protocol stays unreachable on purpose. */
const SMART_ENDPOINTS = new Set(['info/refs', 'git-upload-pack', 'git-receive-pack']);

export interface GitRequestTarget {
  projectId: string;
  /** Endpoint relative to the repository, one of SMART_ENDPOINTS. */
  endpoint: string;
  /** Raw query string without the leading `?` (`service=git-receive-pack`). */
  query: string;
}

/**
 * `/git/mls-102043.git/info/refs?service=git-upload-pack` → `{ projectId, endpoint, query }`.
 *
 * `null` for anything else, and that includes anything with a `..` or an id that is not digits: the id
 * becomes a filesystem path below, so this is the containment check, not a formatting nicety.
 */
export function parseGitPath(url: string | undefined): GitRequestTarget | null {
  if (!url) return null;
  const [pathPart, ...queryParts] = url.split('?');
  const match = /^\/git\/mls-(\d+)(?:\.git)?\/(.+)$/u.exec(pathPart);
  if (!match) return null;
  const endpoint = match[2].replace(/\/+$/u, '');
  if (!SMART_ENDPOINTS.has(endpoint)) return null;
  return { projectId: match[1], endpoint, query: queryParts.join('?') };
}

/**
 * The token a git client sends. Not `tokenFromRequest` from bffAuth: that one is cookie-first because the
 * browser cannot see the httpOnly `cauth`. A git client has no cookie jar for us — a credential helper
 * produces `Authorization: Basic base64(user:password)`, the GitHub-PAT shape, with the token in the
 * PASSWORD field and the username ignored. Bearer stays as the second path (server-to-server, tests).
 */
export function tokenFromGitRequest(headers: Record<string, string | string[] | undefined> | undefined): string {
  const raw = headers?.authorization;
  const authorization = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!authorization) return '';
  const bearer = /^Bearer\s+(.+)$/iu.exec(authorization);
  if (bearer) return bearer[1].trim();
  const basic = /^Basic\s+(.+)$/iu.exec(authorization);
  if (!basic) return '';
  let decoded = '';
  try {
    decoded = Buffer.from(basic[1].trim(), 'base64').toString('utf8');
  } catch {
    return '';
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return decoded.trim();
  const password = decoded.slice(separator + 1).trim();
  // Password first (`git-credential` fills it with the token); the username is the fallback for a
  // helper configured the other way round.
  return password || decoded.slice(0, separator).trim();
}

export interface CgiResponse {
  status: number;
  headers: Record<string, string>;
  /** Body bytes that were already in the same chunk as the headers. */
  rest: Buffer;
}

/**
 * Split a CGI response: headers, then a blank line, then the body. `Status:` is CGI's way of setting the
 * HTTP status and must NOT be forwarded as a header. Returns null while the blank line has not arrived.
 */
export function splitCgiHeaders(buffer: Buffer): CgiResponse | null {
  let separator = buffer.indexOf('\r\n\r\n');
  let width = 4;
  if (separator < 0) {
    separator = buffer.indexOf('\n\n');
    width = 2;
  }
  if (separator < 0) return null;
  const headers: Record<string, string> = {};
  let status = 200;
  for (const line of buffer.subarray(0, separator).toString('utf8').split(/\r?\n/u)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === 'status') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) status = parsed;
      continue;
    }
    headers[name] = value;
  }
  return { status, headers, rest: buffer.subarray(separator + width) };
}

/**
 * Where the repositories live: the mls-base root.
 *
 * NOT `dirname(process.cwd())`, which is what this was and what a live VM proved wrong. The pm2 app
 * is started with `cwd = <mls-base>/current-<id>`, but that alias is a SYMLINK: the OS resolves it,
 * so the real cwd is `<mls-base>/releases/<id>` and its parent is `releases/`. The route then looked
 * for `releases/mls-<id>/.git` and answered "not hosted on this VM" for a project that is right
 * there — a 404 that looks exactly like a configuration mistake.
 *
 * What identifies the root without depending on how deep the cwd sits: it is the nearest ancestor
 * that CONTAINS a `releases` directory. True from a release dir, from an alias, and from the root
 * itself. `COLLAB_GIT_PROJECT_ROOT` still wins, for a layout nobody predicted.
 */
export function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);
  for (let level = 0; level < 8; level += 1) {
    if (existsSync(join(current, 'releases'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Nothing found (a dev checkout with no releases yet): the old guess is still the best guess.
  return dirname(resolve(startDir));
}

export function gitProjectRoot(): string {
  const configured = process.env.COLLAB_GIT_PROJECT_ROOT;
  return configured ? resolve(configured) : findProjectRoot(process.cwd());
}

/** The git DIRECTORY of a project. The repos are working repos (`updateInstead`), so it is `.git`. */
export function projectGitDir(root: string, projectId: string): string {
  return join(root, `mls-${projectId}`, '.git');
}

export interface GitBackendEnvInput {
  root: string;
  projectId: string;
  target: GitRequestTarget;
  method: string;
  email: string;
  remoteAddress: string;
  contentType?: string;
  contentLength?: string;
  contentEncoding?: string;
}

/**
 * The CGI environment of `git http-backend`.
 *
 * `GIT_CONFIG_*` instead of writing the repository's config: http-backend refuses a push unless
 * `http.receivepack` is true, and passing it per request means repositories created BEFORE this route
 * existed (gb14a) work with no migration, and no repository is left permanently push-enabled for a
 * caller that arrives some other way.
 *
 * `CONTENT_LENGTH` is set only when the client sent one: with a chunked body, CGI has no length and
 * http-backend reads stdin to EOF, which is exactly what a large push does.
 */
export function gitBackendEnv(input: GitBackendEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    GIT_PROJECT_ROOT: input.root,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: `/mls-${input.projectId}/.git/${input.target.endpoint}`,
    REQUEST_METHOD: input.method,
    QUERY_STRING: input.target.query,
    REMOTE_USER: input.email,
    REMOTE_ADDR: input.remoteAddress,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.receivepack',
    GIT_CONFIG_VALUE_0: 'true',
    COLLAB_PUSH_ACTOR_EMAIL: input.email,
  };
  if (input.contentType) env.CONTENT_TYPE = input.contentType;
  if (input.contentLength) env.CONTENT_LENGTH = input.contentLength;
  if (input.contentEncoding) env.HTTP_CONTENT_ENCODING = input.contentEncoding;
  return env;
}

export interface PushLogEntry {
  at: string;
  /** `wagner@collab.codes` for a person, `service:cak_ab12…` for automation (see actorOf). */
  actor: string;
  email: string;
  sub: string;
  projectId: string;
  endpoint: string;
  service: string;
  status: number;
  remoteAddress: string;
}

/** One JSON object per line, next to the pm2 logs. Best effort: a push never fails because of the log. */
export function appendPushLog(root: string, entry: PushLogEntry): void {
  try {
    const dir = join(root, 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'git-push.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.warn('[gitHttp] could not write the push log:', (error as Error).message);
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function refuse(reply: FastifyReply, status: number, message: string): void {
  if (status === 401) {
    // Without this header git never asks the credential helper for anything: it just fails, and it
    // looks like the helper is broken rather than like the token is missing.
    reply.header('WWW-Authenticate', 'Basic realm="collab publish (run: pnpm publishGit login)"');
  }
  reply.header('Cache-Control', 'no-cache');
  reply.status(status).type('text/plain; charset=utf-8').send(`${message}\n`);
}

export type GitTokenVerifier = (token: string) => Promise<GitAuthClaims>;

async function serve(request: FastifyRequest, reply: FastifyReply, verify: GitTokenVerifier): Promise<void> {
  const target = parseGitPath(request.raw.url);
  if (!target) {
    refuse(reply, 404, 'not a git endpoint of this VM');
    return;
  }

  const root = gitProjectRoot();
  const gitDir = projectGitDir(root, target.projectId);
  if (!existsSync(gitDir)) {
    refuse(reply, 404, `mls-${target.projectId} is not hosted on this VM`);
    return;
  }

  const token = tokenFromGitRequest(request.headers);
  if (!token) {
    refuse(reply, 401, 'authentication required (collab-auth token)');
    return;
  }
  let claims: GitAuthClaims;
  try {
    claims = await verify(token);
  } catch (error) {
    // The reason goes to the server log, never to the client: it would tell an anonymous caller
    // whether a token is merely expired.
    console.warn(`[gitHttp] refused ${target.endpoint} on mls-${target.projectId}:`, (error as Error).message);
    refuse(reply, 401, 'invalid or expired token (run: pnpm publishGit login)');
    return;
  }

  // Alpha authority (gb50 D4): authenticated = may publish. This is the ONE place to plug the
  // per-project authorities of the F1 module — the transport does not change when it arrives.
  const email = typeof claims.email === 'string' ? claims.email : '';
  const remoteAddress = request.ip ?? '';
  const service = new URLSearchParams(target.query).get('service') ?? target.endpoint;

  const env = gitBackendEnv({
    root,
    projectId: target.projectId,
    target,
    method: request.method,
    email,
    remoteAddress,
    contentType: header(request, 'content-type'),
    contentLength: header(request, 'content-length'),
    contentEncoding: header(request, 'content-encoding'),
  });

  const child = spawn(gitHttpBackendPath(), [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let headersSent = false;
  let status = 200;
  let pending = Buffer.alloc(0);

  reply.hijack();

  child.stdout.on('data', (chunk: Buffer) => {
    if (headersSent) {
      reply.raw.write(chunk);
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    const parsed = splitCgiHeaders(pending);
    if (!parsed) return;
    headersSent = true;
    status = parsed.status;
    reply.raw.writeHead(parsed.status, parsed.headers);
    if (parsed.rest.length) reply.raw.write(parsed.rest);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) console.warn(`[gitHttp] http-backend: ${text}`);
  });

  // `error` and `close` can BOTH fire (a failed spawn emits error and then closes). Writing a header
  // twice throws inside an event handler, which took down the request instead of answering it — so
  // finishing is idempotent, and it is the only place that ends the response.
  const finish = (fallbackStatus: number, message: string): void => {
    if (!headersSent) {
      headersSent = true;
      status = fallbackStatus;
      reply.raw.writeHead(fallbackStatus, { 'Content-Type': 'text/plain; charset=utf-8' });
      reply.raw.write(message);
    }
    if (!reply.raw.writableEnded) reply.raw.end();
  };

  child.on('error', (error) => {
    console.error('[gitHttp] could not spawn git http-backend:', error.message);
    finish(500, 'git is not available on this VM\n');
  });

  child.on('close', () => {
    // http-backend answered nothing parseable — a 500 the client can see beats a hung connection.
    finish(500, 'git http-backend produced no response\n');
    appendPushLog(root, {
      at: new Date().toISOString(),
      actor: actorOf(claims),
      email,
      sub: typeof claims.sub === 'string' ? claims.sub : '',
      projectId: target.projectId,
      endpoint: target.endpoint,
      service,
      status,
      remoteAddress,
    });
  });

  // The request body is piped raw: the pass-through content-type parser below keeps Fastify from
  // draining it, and http-backend is the one that inflates a gzipped push.
  if (request.method === 'POST') {
    request.raw.pipe(child.stdin);
  } else {
    child.stdin.end();
  }
}

let backendPath = '';
/**
 * O caminho do `git-http-backend`.
 *
 * Ele NÃO está no PATH em nenhuma das duas plataformas que a gente usa — no Ubuntu vive em
 * `/usr/lib/git-core`, no macOS dentro do CommandLineTools — então chamá-lo pelo nome dá ENOENT e a
 * requisição fica pendurada esperando um processo que nunca subiu. Quem sabe onde ele está é o próprio
 * git (`git --exec-path`), e a resposta é estável por instalação: resolve uma vez e guarda.
 */
function gitHttpBackendPath(): string {
  if (process.env.COLLAB_GIT_HTTP_BACKEND) return process.env.COLLAB_GIT_HTTP_BACKEND;
  if (backendPath) return backendPath;
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const dir = (execPath.stdout ?? '').trim();
  backendPath = dir ? join(dir, 'git-http-backend') : 'git-http-backend';
  return backendPath;
}

/**
 * The git door. Registered BEFORE the catch-all `GET /*` for the same reason `/libs/*` is: the first
 * matching route wins, and `/git/...` must not be answered with the SPA shell.
 *
 * `COLLAB_GIT_HTTP_ENABLED=false` closes it entirely (the emergency stop). Default open, because
 * closed-by-default would mean a VM nobody can publish to, and the door refuses everyone without a
 * verified token anyway.
 */
export function registerGitRoutes(app: FastifyInstance, verify: GitTokenVerifier): void {
  if (process.env.COLLAB_GIT_HTTP_ENABLED === 'false') {
    console.info('[gitHttp] disabled (COLLAB_GIT_HTTP_ENABLED=false)');
    return;
  }
  for (const contentType of ['application/x-git-upload-pack-request', 'application/x-git-receive-pack-request']) {
    app.addContentTypeParser(contentType, (_request, payload, done) => {
      // Hand the stream back untouched: parsing it would drain the packfile before it reaches git.
      done(null, payload);
    });
  }
  app.get('/git/*', (request, reply) => serve(request, reply, verify));
  app.post('/git/*', (request, reply) => serve(request, reply, verify));
  console.info(`[gitHttp] /git/mls-<id>.git -> git http-backend at ${gitProjectRoot()} (JWT required, always)`);
}
