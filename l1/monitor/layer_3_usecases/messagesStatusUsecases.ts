/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/messagesStatusUsecases.ts" enhancement="_blank" />
import { execFileSync } from 'node:child_process';
import type {
  MonitorMessagesPm2Process,
  MonitorMessagesStatusResponse,
  MonitorMessagesStorage,
} from '/_102034_/l2/monitor/shared/contracts/messages.js';

// Same default as msgProxy.ts. That file is not imported: the monitor only
// reads MSG_PROXY_TARGET, it does not share the proxy implementation.
const DEFAULT_TARGET = 'http://127.0.0.1:8180';
const HEALTH_TIMEOUT_MS = 12_000;
const MSG_PM2_NAMES = ['msg', 'msg-worker'] as const;

export interface MessagesStatusDeps {
  fetchFn?: typeof fetch;
  listPm2?: () => unknown;
  now?: () => Date;
  getTarget?: () => string;
}

export function resolveMsgProxyTarget(env: NodeJS.ProcessEnv = process.env): string {
  return (env.MSG_PROXY_TARGET ?? DEFAULT_TARGET).replace(/\/+$/u, '');
}

export function isLocalMsgTarget(target: string): boolean {
  try {
    const hostname = new URL(target).hostname.toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return true;
  }
}

export function msgHealthUrl(target: string, local: boolean): string {
  // Local: the msg process itself (port 8180) serves /health.
  // Remote: MSG_PROXY_TARGET is the host project's public origin, so the
  // collab-messages probe is /msg/health (plain /health is the app).
  return local ? `${target}/health` : `${target}/msg/health`;
}

export function msgReadyUrl(target: string, local: boolean): string {
  return local ? `${target}/ready` : `${target}/msg/ready`;
}

export async function loadMessagesStatus(
  deps: MessagesStatusDeps = {},
): Promise<MonitorMessagesStatusResponse> {
  const target = (deps.getTarget ?? resolveMsgProxyTarget)();
  const local = isLocalMsgTarget(target);
  const fetchFn = deps.fetchFn ?? fetch;
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const healthUrl = msgHealthUrl(target, local);
  const readyUrl = msgReadyUrl(target, local);

  const [healthHit, readyHit] = await Promise.all([
    fetchJson(healthUrl, fetchFn),
    fetchJson(readyUrl, fetchFn),
  ]);

  let pm2: MonitorMessagesPm2Process[] = [];
  let pm2Error: string | undefined;
  if (local) {
    try {
      const raw = (deps.listPm2 ?? defaultListPm2)();
      pm2 = collectPm2(raw, generatedAt);
    } catch (error) {
      pm2Error = error instanceof Error ? error.message : String(error);
    }
  }

  const response: MonitorMessagesStatusResponse = {
    generatedAt,
    target,
    local,
    health: {
      reachable: healthHit.reachable,
      url: healthUrl,
      statusCode: healthHit.statusCode,
      storage: pickStorage(healthHit.body),
      ...(healthHit.error ? { error: healthHit.error } : {}),
    },
    ready: {
      reachable: readyHit.reachable,
      url: readyUrl,
      statusCode: readyHit.statusCode,
      ...pickReady(readyHit.body),
      ...(readyHit.error ? { error: readyHit.error } : {}),
    },
    pm2,
  };
  if (pm2Error) response.pm2Error = pm2Error;
  return response;
}

function defaultListPm2(): unknown {
  const stdout = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 8_000 });
  return JSON.parse(stdout) as unknown;
}

interface FetchHit {
  reachable: boolean;
  statusCode: number | null;
  body: unknown;
  error?: string;
}

async function fetchJson(url: string, fetchFn: typeof fetch): Promise<FetchHit> {
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) as unknown : null;
    } catch {
      body = text;
    }
    return { reachable: true, statusCode: response.status, body };
  } catch (error) {
    return {
      reachable: false,
      statusCode: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pickStorage(body: unknown): MonitorMessagesStorage | null {
  if (!body || typeof body !== 'object') return null;
  const storage = (body as { storage?: unknown }).storage;
  if (!storage || typeof storage !== 'object') return null;
  const rec = storage as Record<string, unknown>;
  const out: MonitorMessagesStorage = {};
  if (typeof rec.dynamoRegion === 'string') out.dynamoRegion = rec.dynamoRegion;
  if (typeof rec.s3Region === 'string') out.s3Region = rec.s3Region;
  if (typeof rec.bucket === 'string') out.bucket = rec.bucket;
  if (typeof rec.tablePrefix === 'string') out.tablePrefix = rec.tablePrefix;
  if (typeof rec.instanceId === 'string' || rec.instanceId === null) {
    out.instanceId = rec.instanceId as string | null;
  }
  if (typeof rec.accountId === 'string') out.accountId = rec.accountId;
  if (typeof rec.ok === 'boolean') out.ok = rec.ok;
  if (typeof rec.error === 'string') out.error = rec.error;
  return out;
}

function pickReady(body: unknown): { status?: string; error?: string } {
  if (!body || typeof body !== 'object') return {};
  const rec = body as Record<string, unknown>;
  const out: { status?: string; error?: string } = {};
  if (typeof rec.status === 'string') out.status = rec.status;
  if (typeof rec.error === 'string') out.error = rec.error;
  return out;
}

interface Pm2JlistItem {
  name?: string;
  pm2_env?: {
    status?: string;
    restart_time?: number;
    pm_uptime?: number;
  };
  monit?: {
    memory?: number;
    cpu?: number;
  };
}

function collectPm2(raw: unknown, generatedAt: string): MonitorMessagesPm2Process[] {
  const items = Array.isArray(raw) ? raw as Pm2JlistItem[] : [];
  const now = Date.parse(generatedAt);
  return MSG_PM2_NAMES.map((name) => {
    const group = items.filter((item) => item.name === name);
    if (group.length === 0) {
      return {
        name,
        instances: 0,
        status: 'missing',
        restarts: 0,
        uptimeMs: null,
        memoryMb: null,
        cpu: null,
      };
    }
    const statuses = group.map((item) => item.pm2_env?.status ?? 'unknown');
    const allOnline = statuses.every((status) => status === 'online');
    const someOnline = statuses.some((status) => status === 'online');
    const status = allOnline ? 'online' : someOnline ? 'partial' : (statuses[0] ?? 'unknown');
    const restarts = group.reduce((sum, item) => sum + (item.pm2_env?.restart_time ?? 0), 0);
    const uptimes = group
      .map((item) => item.pm2_env?.pm_uptime)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const memory = group.reduce((sum, item) => sum + (item.monit?.memory ?? 0), 0);
    const cpu = group.reduce((sum, item) => sum + (item.monit?.cpu ?? 0), 0);
    return {
      name,
      instances: group.length,
      status,
      restarts,
      uptimeMs: uptimes.length > 0 && Number.isFinite(now) ? now - Math.min(...uptimes) : null,
      memoryMb: memory > 0 ? Math.round((memory / 1024 / 1024) * 10) / 10 : 0,
      cpu: Math.round(cpu * 10) / 10,
    };
  });
}
