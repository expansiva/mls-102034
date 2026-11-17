import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

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

  try {
    const response = await bounded(fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: ac.signal,
    })).catch((err: unknown): never => {
      if (err instanceof AppError) throw err;
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
