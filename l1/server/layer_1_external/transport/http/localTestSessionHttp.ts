/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/localTestSessionHttp.ts" enhancement="_blank" />
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getLocalTestConfig,
  type LocalTestAlias,
  type LocalTestConfig,
} from '/_102034_/l1/server/layer_1_external/config/localTestConfig.js';
import {
  LOCAL_TEST_MAX_AGE_SEC,
  localTestCookieName,
  mintLocalTestCookie,
  readLocalTestCookie,
} from '/_102034_/l1/server/layer_1_external/auth/localTestSession.js';

const NOT_FOUND = { statusCode: 404, msg: 'Not found' };
const REFUSED = { statusCode: 403, msg: 'Refused' };
const REJECTED = { statusCode: 400, msg: 'Rejected' };

const IDENTITY_HEADERS = [
  'name', 'x-name',
  'email', 'x-email',
  'sub', 'x-sub',
  'mdmid', 'x-mdm-id', 'x-person-mdm-id', 'personmdmid',
  'cmid', 'x-cm-id', 'x-cm-user-id',
];

function headerValue(headers: FastifyRequest['headers'], name: string): string {
  const value = headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.trim() : '';
}

function hostOfOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (!url.port) return null;
    return `${url.hostname}:${url.port}`.toLowerCase();
  } catch {
    return null;
  }
}

function hostAllowed(host: string, state: LocalTestConfig): boolean {
  if (!host || host.includes(' ') || host.startsWith('[')) return false;
  return state.allowedOrigins.some((origin) => hostOfOrigin(origin) === host.toLowerCase());
}

/** Active bench on an allowed local host. Anything else is hidden (404). */
export function localTestBenchOrNull(host: string): LocalTestConfig | null {
  try {
    const state = getLocalTestConfig();
    if (!state.enabled || !hostAllowed(host, state)) return null;
    return state;
  } catch {
    return null;
  }
}

function secureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

/** Host-only cookie. No Domain attribute. Secure only when the request itself is HTTPS. */
export function localTestSetCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function expiredLocalTestCookie(projectId: string, secure: boolean): string {
  return localTestSetCookie(localTestCookieName(projectId), '', 0, secure);
}

function notFound(reply: FastifyReply) {
  reply.status(404).header('cache-control', 'no-store');
  return NOT_FOUND;
}

function identitySupplied(request: FastifyRequest): boolean {
  if (request.url.includes('?')) return true;
  const query = request.query;
  if (query && typeof query === 'object' && Object.keys(query as object).length > 0) return true;
  return IDENTITY_HEADERS.some((name) => request.headers[name] !== undefined);
}

function readPersona(body: unknown): LocalTestAlias | null | 'bad' {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'bad';
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'persona')) return 'bad';
  const persona = record.persona;
  if (persona === null) return null;
  if (persona === 'responsavel' || persona === 'membro') return persona;
  return 'bad';
}

function currentAlias(request: FastifyRequest, state: LocalTestConfig): string {
  const cookie = headerValue(request.headers, 'cookie');
  const match = new RegExp(`(?:^|;\\s*)${localTestCookieName(state.projectId)}=([^;]*)`, 'u').exec(cookie);
  if (!match) return '';
  let token = match[1];
  try {
    token = decodeURIComponent(token);
  } catch { /* keep raw */ }
  const persona = readLocalTestCookie(token, state, headerValue(request.headers, 'host'), headerValue(request.headers, 'origin'));
  return persona?.alias ?? '';
}

function selectorHtml(alias: string): string {
  const selected = JSON.stringify(alias);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Local test session</title></head>
<body>
<p id="banner"></p>
<p id="current"></p>
<p id="limit"></p>
<p id="error"></p>
<button type="button" id="pick-responsavel"></button>
<button type="button" id="pick-membro"></button>
<button type="button" id="pick-none"></button>
<script>
(function () {
  var selected = ${selected};
  document.getElementById('banner').textContent = 'Local test session';
  document.getElementById('current').textContent = selected
    ? 'Selected: ' + selected
    : 'Selected: none';
  document.getElementById('limit').textContent = 'One browser profile per user. Close other tabs of this origin before switching.';
  document.getElementById('pick-responsavel').textContent = 'responsavel';
  document.getElementById('pick-membro').textContent = 'membro';
  document.getElementById('pick-none').textContent = 'Leave session';
  var CLEAR_MS = 3000;
  function clearCmCache() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
      var timer = setTimeout(function () { finish(reject, new Error('timeout')); }, CLEAR_MS);
      var request;
      try { request = indexedDB.deleteDatabase('msgDB'); }
      catch (error) { finish(reject, error); return; }
      request.onblocked = function () { finish(reject, new Error('blocked')); };
      request.onerror = function () { finish(reject, new Error('error')); };
      request.onsuccess = function () {
        try {
          localStorage.removeItem('serviceCollabMessages');
          localStorage.removeItem('collabMessages_userId');
        } catch (error) { finish(reject, error); return; }
        finish(resolve, undefined);
      };
    });
  }
  async function select(persona) {
    var error = document.getElementById('error');
    error.textContent = '';
    try { await clearCmCache(); }
    catch (failure) {
      error.textContent = failure && failure.message === 'blocked'
        ? 'Close the other tabs of this origin, then try again.'
        : 'Could not clear the local message cache. The session was not changed.';
      return;
    }
    var response = await fetch('/__test/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: persona })
    });
    if (!response.ok) {
      error.textContent = 'The session was not changed.';
      return;
    }
    location.assign('/');
  }
  document.getElementById('pick-responsavel').addEventListener('click', function () { select('responsavel'); });
  document.getElementById('pick-membro').addEventListener('click', function () { select('membro'); });
  document.getElementById('pick-none').addEventListener('click', function () { select(null); });
}());
</script>
</body>
</html>`;
}

export function registerLocalTestSessionRoutes(app: FastifyInstance): void {
  app.get('/__test/session', async (request, reply) => {
    const state = localTestBenchOrNull(headerValue(request.headers, 'host'));
    if (!state) return notFound(reply);
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return selectorHtml(currentAlias(request, state));
  });

  app.post('/__test/session', async (request, reply) => {
    const host = headerValue(request.headers, 'host');
    const state = localTestBenchOrNull(host);
    if (!state) return notFound(reply);
    const origin = headerValue(request.headers, 'origin');
    if (!origin || !state.allowedOrigins.includes(origin) || hostOfOrigin(origin) !== host.toLowerCase()) {
      reply.status(403).header('cache-control', 'no-store');
      return REFUSED;
    }
    if (identitySupplied(request)) {
      reply.status(400).header('cache-control', 'no-store');
      return REJECTED;
    }
    const persona = readPersona(request.body);
    if (persona === 'bad') {
      reply.status(400).header('cache-control', 'no-store');
      return REJECTED;
    }
    const secure = secureRequest(request);
    const header = persona === null
      ? expiredLocalTestCookie(state.projectId, secure)
      : localTestSetCookie(localTestCookieName(state.projectId), mintLocalTestCookie(persona, state), LOCAL_TEST_MAX_AGE_SEC, secure);
    reply.status(204).header('cache-control', 'no-store').header('set-cookie', header);
    return null;
  });
}
