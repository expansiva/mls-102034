import http from 'node:http';
import https from 'node:https';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

/** Node's `fetch` stops waiting for response headers at 300s. A longer call uses `node:http` instead. */
const NODE_FETCH_HEADER_LIMIT_MS = 300_000;

/**
 * The one transport to collab-messages: the POST of an action, with a time limit, redirects refused and the answer read
 * only inside the same limit, and the envelope (`statusCode` in the body) checked. The server client (`client.ts`) and the
 * connection caller (`connections/callConnection.ts`) both go through here; there is no second copy.
 */
export type EnvelopeResponse = { httpStatus: number; body: Record<string, unknown> & { statusCode: number } };

export type PostEnvelopeInput = {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  /** The action name, for the messages of the errors. */
  label: string;
};

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

function isFetchTimeout(err: unknown): boolean {
  if (isAbortError(err)) return true;
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
}

function timeoutFailure(kind: 'headers' | 'body'): Error {
  return Object.assign(new Error(`${kind} timeout`), { code: kind === 'headers' ? 'UND_ERR_HEADERS_TIMEOUT' : 'UND_ERR_BODY_TIMEOUT' });
}

/** Header and body deadlines for a call longer than Node's `fetch` allows. Redirects stay off, as `redirect: 'manual'`. */
function postLong(url: string, headers: Record<string, string>, body: string, timeoutMs: number, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let settled = false;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (headerTimer) clearTimeout(headerTimer);
      if (bodyTimer) clearTimeout(bodyTimer);
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
    }, (res) => {
      if (headerTimer) clearTimeout(headerTimer);
      const chunks: Buffer[] = [];
      bodyTimer = setTimeout(() => {
        res.destroy();
        finish(() => reject(timeoutFailure('body')));
      }, timeoutMs);
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => {
        const payload = Buffer.concat(chunks);
        finish(() => resolve(new Response(payload, { status: res.statusCode ?? 0 })));
      });
      res.on('error', (err) => finish(() => reject(err)));
    });
    const onAbort = (): void => {
      req.destroy();
      finish(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    };
    headerTimer = setTimeout(() => {
      req.destroy();
      finish(() => reject(timeoutFailure('headers')));
    }, timeoutMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    req.on('error', (err) => finish(() => reject(err)));
    req.end(body);
  });
}

export function isEnvelope(value: unknown): value is Record<string, unknown> & { statusCode: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const statusCode = (value as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599;
}

/** Module credentials of one application: the private token of the project, never another project's. */
/** `asUserId` is the person of the call; a call made as the app itself (the connection caller) sends none. */
export function moduleHeaders(projectId: string | undefined, boundProject: string, asUserId?: string): Record<string, string> {
  if (projectId === undefined) {
    throw new AppError('MSG_APP_NOT_CONFIGURED', 'Messages integration is not configured for this application.', 503);
  }
  if (boundProject !== projectId) {
    throw new AppError('MSG_APP_SCOPE_INVALID', 'Module operation is outside the configured application.', 400);
  }
  const integration = readMessagesIntegration(projectId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: `Bearer ${integration.token}`,
    'x-app-id': integration.projectId,
    'x-org-id': integration.organizationId,
  };
  if (asUserId !== undefined) headers['x-user-id'] = asUserId;
  return headers;
}

export async function postEnvelope(input: PostEnvelopeInput): Promise<EnvelopeResponse> {
  const { fetchImpl, url, headers, body, timeoutMs, label } = input;
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);

  const timeout = (): AppError => new AppError('MSG_SERVICE_TIMEOUT', `collab-messages ${label} timed out`, 504);
  const failUnavailable = (): never => {
    throw new AppError('MSG_SERVICE_UNAVAILABLE', `collab-messages ${label} unavailable`, 502);
  };
  const protocolError = (status: number): AppError =>
    new AppError('MSG_SERVICE_PROTOCOL_ERROR', `collab-messages ${label} protocol error (http ${status})`, 502);

  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    if (timedOut || ac.signal.aborted) throw timeout();
    return await new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(timeout());
      };
      ac.signal.addEventListener('abort', onAbort, { once: true });
      work.then(
        (value) => {
          ac.signal.removeEventListener('abort', onAbort);
          if (timedOut || ac.signal.aborted) onAbort();
          else resolve(value);
        },
        (err: unknown) => {
          ac.signal.removeEventListener('abort', onAbort);
          if (timedOut || ac.signal.aborted || isAbortError(err)) onAbort();
          else reject(err);
        },
      );
    });
  };

  const send = fetchImpl === fetch && timeoutMs > NODE_FETCH_HEADER_LIMIT_MS
    ? postLong(url, headers, body, timeoutMs, ac.signal)
    : fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: ac.signal,
    });

  try {
    const response = await bounded(send).catch((err: unknown): never => {
      if (err instanceof AppError) throw err;
      if (isFetchTimeout(err)) throw timeout();
      return failUnavailable();
    });

    if (response.status >= 300 && response.status < 400) {
      await bounded(response.arrayBuffer()).catch((err: unknown) => {
        if (err instanceof AppError) throw err;
      });
      throw protocolError(response.status);
    }

    const text = await bounded(response.text()).catch((err: unknown): never => {
      if (err instanceof AppError) throw err;
      if (isFetchTimeout(err)) throw timeout();
      return failUnavailable();
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw protocolError(response.status);
    }
    if (!isEnvelope(parsed)) throw protocolError(response.status);
    return { httpStatus: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}
