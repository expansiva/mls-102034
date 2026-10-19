/// <mls fileReference="_102034_/l1/server/layer_1_external/config/messagesIntegration.ts" enhancement="_blank" />
import { readProjectFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export interface MessagesIntegration {
  readonly projectId: string;
  readonly organizationId: string;
  readonly token: string;
}

const SCOPE_INVALID = 'MSG_APP_SCOPE_INVALID';
const NOT_CONFIGURED = 'MSG_APP_NOT_CONFIGURED';

/**
 * Canonical decimal project id: digits only, no sign, no leading zero, and a
 * safe positive integer so the value survives the numeric file key unchanged.
 */
function canonicalProjectId(projectId: string): number | null {
  if (!/^[1-9][0-9]*$/.test(projectId)) return null;
  const numeric = Number(projectId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || String(numeric) !== projectId) return null;
  return numeric;
}

function notConfigured(): AppError {
  return new AppError(NOT_CONFIGURED, 'Messages integration is not configured for this application.', 503);
}

function integrationToken(block: unknown): string | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const token = (block as { token?: unknown }).token;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (token !== token.trim()) return null;
  if (/[\r\n\u2028\u2029]/.test(token)) return null;
  return token;
}

/**
 * Server-side credential for one application. The caller passes the project id
 * already resolved on the server. Each call goes through readProjectFile, which
 * refreshes on mtime; this function keeps no token of its own.
 */
export function readMessagesIntegration(projectId: string): MessagesIntegration {
  const numericId = canonicalProjectId(projectId);
  if (numericId === null) {
    throw new AppError(SCOPE_INVALID, 'Application id is not a canonical positive integer.', 400);
  }

  let file: ReturnType<typeof readProjectFile>;
  try {
    file = readProjectFile(numericId);
  } catch {
    throw notConfigured();
  }
  if (!file) throw notConfigured();

  const fileProjectId = file.project?.projectId;
  if (typeof fileProjectId !== 'string' || fileProjectId !== projectId) throw notConfigured();

  const organizationId = file.org?.orgId;
  if (typeof organizationId !== 'string' || organizationId.length === 0) throw notConfigured();

  const token = integrationToken(file.collabMessages);
  if (token === null) throw notConfigured();

  return Object.freeze({
    projectId,
    organizationId,
    token,
  });
}
