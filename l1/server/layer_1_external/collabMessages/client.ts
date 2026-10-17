import { ensureEnvFileLoaded } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { msgProxyTarget, serviceIdentityHeaders } from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';
import type {
  RequestAddMessage,
  RequestAddUserInThread,
  RequestApplyIntents,
  RequestEnsureModuleThread,
  RequestGetTaskUpdate,
  RequestOpenModuleTask,
  ResponseAddMessage,
  ResponseAddUserInThread,
  ResponseApplyIntents,
  ResponseBase,
  ResponseEnsureModuleThread,
  ResponseGetTaskUpdate,
  ResponseOpenModuleTask,
} from '/_102036_/l2/shared/interfaces.js';

const DEFAULT_TIMEOUT_MS = 10_000;

const NOT_CONFIGURED = 'collab-messages service is not configured';

type ActionName =
  | 'ensureModuleThread'
  | 'openModuleTask'
  | 'applyIntents'
  | 'getTaskUpdate'
  | 'addMessage'
  | 'addUserInThread';

export type MessagesCallResult<T> = {
  httpStatus: number;
  body: ResponseBase & Partial<T> & { code?: string };
};

export type ServerMessagesClientOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type ServerMessagesClient = {
  ensureModuleThread(
    asUserId: string,
    input: Omit<RequestEnsureModuleThread, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseEnsureModuleThread>>;
  openModuleTask(
    asUserId: string,
    input: Omit<RequestOpenModuleTask, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseOpenModuleTask>>;
  applyIntents(
    asUserId: string,
    input: Omit<RequestApplyIntents, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseApplyIntents>>;
  getTaskUpdate(
    asUserId: string,
    input: Omit<RequestGetTaskUpdate, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseGetTaskUpdate>>;
  addMessage(
    asUserId: string,
    input: Omit<RequestAddMessage, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseAddMessage>>;
  addUserInThread(
    asUserId: string,
    input: Omit<RequestAddUserInThread, 'action' | 'userId'>,
  ): Promise<MessagesCallResult<ResponseAddUserInThread>>;
};

function timeoutMsOf(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new AppError('MSG_SERVICE_NOT_CONFIGURED', NOT_CONFIGURED, 503);
  }
  return timeoutMs;
}

function callerUserId(asUserId: string): string {
  const userId = asUserId.trim();
  if (!userId || /[\r\n]/u.test(asUserId) || /[\r\n]/u.test(userId)) {
    throw new AppError('MSG_SERVICE_NOT_CONFIGURED', NOT_CONFIGURED, 503);
  }
  return userId;
}

function localError(code: string, statusCode: number, message: string): AppError {
  return new AppError(code, message, statusCode);
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

function isEnvelope(value: unknown): value is Record<string, unknown> & { statusCode: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const statusCode = (value as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599;
}

export function createServerMessagesClient(options: ServerMessagesClientOptions = {}): ServerMessagesClient {
  const timeoutMs = timeoutMsOf(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (options.env === undefined) ensureEnvFileLoaded();
  const capturedEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };

  async function call<T>(
    action: ActionName,
    asUserId: string,
    input: object,
  ): Promise<MessagesCallResult<T>> {
    const userId = callerUserId(asUserId);
    const identity = serviceIdentityHeaders({ ...capturedEnv, MSG_PROXY_USER_ID: userId });
    if (!('inject' in identity) || identity.inject === null) {
      throw localError('MSG_SERVICE_NOT_CONFIGURED', 503, `${NOT_CONFIGURED} (${action})`);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      authorization: identity.inject.authorization,
      'x-user-id': identity.inject['x-user-id'],
    };
    if (identity.inject['x-org-id']) headers['x-org-id'] = identity.inject['x-org-id'];

    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);

    const failTimeout = (): never => {
      throw localError('MSG_SERVICE_TIMEOUT', 504, `collab-messages ${action} timed out`);
    };

    const failUnavailable = (): never => {
      throw localError('MSG_SERVICE_UNAVAILABLE', 502, `collab-messages ${action} unavailable`);
    };

    const bounded = async <T>(work: Promise<T>): Promise<T> => {
      if (timedOut || ac.signal.aborted) failTimeout();
      return await new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
          reject(localError('MSG_SERVICE_TIMEOUT', 504, `collab-messages ${action} timed out`));
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
      const response = await bounded(fetchImpl(`${msgProxyTarget(capturedEnv)}/msg`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...input, action, userId }),
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
        throw localError(
          'MSG_SERVICE_PROTOCOL_ERROR',
          502,
          `collab-messages ${action} protocol error (http ${response.status})`,
        );
      }

      const text = await bounded(response.text()).catch((err: unknown): never => {
        if (err instanceof AppError) throw err;
        return failUnavailable();
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw localError(
          'MSG_SERVICE_PROTOCOL_ERROR',
          502,
          `collab-messages ${action} protocol error (http ${response.status})`,
        );
      }
      if (!isEnvelope(parsed)) {
        throw localError(
          'MSG_SERVICE_PROTOCOL_ERROR',
          502,
          `collab-messages ${action} protocol error (http ${response.status})`,
        );
      }
      return {
        httpStatus: response.status,
        body: parsed as MessagesCallResult<T>['body'],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ensureModuleThread: (asUserId, input) => call('ensureModuleThread', asUserId, input),
    openModuleTask: (asUserId, input) => call('openModuleTask', asUserId, input),
    applyIntents: (asUserId, input) => call('applyIntents', asUserId, input),
    getTaskUpdate: (asUserId, input) => call('getTaskUpdate', asUserId, input),
    addMessage: (asUserId, input) => call('addMessage', asUserId, input),
    addUserInThread: (asUserId, input) => call('addUserInThread', asUserId, input),
  };
}
