/// <mls fileReference="_102034_/l1/server/layer_1_external/config/localTestConfig.ts" enhancement="_blank" />
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { hasDeclaredProjectMode, isTestMode, readProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

/** Aliases provisioned by the lima bench. Browser-supplied MDM or cm ids are not a lookup key. */
export const LOCAL_TEST_ALIASES = ['responsavel', 'membro'] as const;
export type LocalTestAlias = (typeof LOCAL_TEST_ALIASES)[number];

export interface LocalTestPersona {
  alias: LocalTestAlias;
  email: string;
  name: string;
  sub: string;
  personMdmId: string;
  cmUserId: string;
}

export interface LocalTestConfig {
  enabled: true;
  projectId: string;
  organizationKey: string;
  companyMdmId: string;
  cmOrgId: string;
  cmTarget: string;
  storagePrefix: string;
  allowedOrigins: readonly string[];
  cookieKey: string;
  personas: Record<LocalTestAlias, LocalTestPersona>;
}

export type LocalTestConfigState = { enabled: false } | LocalTestConfig;

export class LocalTestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalTestConfigError';
  }
}

export interface LocalTestConfigDeps {
  readText?: (filePath: string) => string;
  fileMode?: (filePath: string) => number;
  defaultProjectId?: () => string;
  /** When set, skips l5/project.json. `declared: false` is an undeclared mode. */
  projectMode?: (projectId: string) => { declared: boolean; mode: string };
}

const CM_TARGET = 'http://127.0.0.1:8180';
const STORAGE_PREFIX = 'desenv_';
const DISABLED: LocalTestConfigState = { enabled: false };

let cache: { state: LocalTestConfigState } | { error: LocalTestConfigError } | undefined;

function fail(message: string): never {
  throw new LocalTestConfigError(message);
}

function isEnabledFlag(env: NodeJS.ProcessEnv): boolean {
  return (env.LOCAL_TEST_SESSION_ENABLED ?? '').trim() === 'true';
}

/** Slot port of a client project id (102047 → 2047). Unknown shapes are refused. */
export function localTestAppPort(projectId: string): number | null {
  if (!/^10\d{4}$/u.test(projectId)) return null;
  const port = Number(projectId) - 100000;
  if (port < 1 || port > 65535) return null;
  return port;
}

function assertPrivateFile(filePath: string, deps: LocalTestConfigDeps): void {
  let mode: number;
  try {
    mode = deps.fileMode ? deps.fileMode(filePath) : statSync(filePath).mode & 0o777;
  } catch {
    fail('local test session manifest is missing or unreadable');
  }
  if (mode !== 0o600) fail('local test session manifest is missing or unreadable');
}

function readManifest(filePath: string, deps: LocalTestConfigDeps): unknown {
  try {
    const text = deps.readText ? deps.readText(filePath) : readFileSync(filePath, 'utf8');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof LocalTestConfigError) throw error;
    fail('local test session manifest is invalid');
  }
}

function stringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertOrigin(origin: string, port: number): void {
  if (origin.includes('*')) fail('local test session manifest is invalid');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    fail('local test session manifest is invalid');
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    url.protocol !== 'http:'
    || !localHost
    || url.port !== String(port)
    || url.username !== ''
    || url.password !== ''
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search !== ''
    || url.hash !== ''
  ) {
    fail('local test session manifest is invalid');
  }
}

function parsePersona(alias: LocalTestAlias, value: unknown): LocalTestPersona {
  if (value === null || typeof value !== 'object') fail('local test session manifest is invalid');
  const record = value as Record<string, unknown>;
  const email = stringField(record.email);
  const name = stringField(record.name);
  const sub = stringField(record.sub);
  const personMdmId = stringField(record.personMdmId);
  const cmUserId = stringField(record.cmUserId);
  if (!email || !name || !sub || !personMdmId || !cmUserId) fail('local test session manifest is invalid');
  if (!/^[^\s@]+@[^\s@]+\.test$/u.test(email)) fail('local test session manifest is invalid');
  return { alias, email, name, sub, personMdmId, cmUserId };
}

function parseManifest(raw: unknown, projectId: string): LocalTestConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('local test session manifest is invalid');
  const manifest = raw as Record<string, unknown>;
  if (manifest.schema !== 1 || manifest.scope !== 'lima') fail('local test session manifest is invalid');
  if (stringField(manifest.projectId) !== projectId) fail('local test session manifest does not match this application');

  const organizationKey = stringField(manifest.organizationKey);
  const companyMdmId = stringField(manifest.companyMdmId);
  const cmOrgId = stringField(manifest.cmOrgId);
  const cmTarget = stringField(manifest.cmTarget);
  const storagePrefix = stringField(manifest.storagePrefix);
  const cookieKey = typeof manifest.cookieKey === 'string' ? manifest.cookieKey : '';
  if (!organizationKey || !companyMdmId || !cmOrgId || !cmTarget || !storagePrefix) {
    fail('local test session manifest is invalid');
  }
  if (cmOrgId !== `runtime-test:${projectId}`) fail('local test session manifest is invalid');
  if (cmTarget !== CM_TARGET || storagePrefix !== STORAGE_PREFIX) fail('local test session manifest is invalid');
  if (Buffer.byteLength(cookieKey) < 32) fail('local test session manifest is invalid');

  const port = localTestAppPort(projectId);
  const origins = manifest.allowedOrigins;
  if (port === null || !Array.isArray(origins) || origins.length === 0) fail('local test session manifest is invalid');
  const allowedOrigins: string[] = [];
  for (const origin of origins) {
    if (typeof origin !== 'string') fail('local test session manifest is invalid');
    assertOrigin(origin, port);
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  }

  const personasRaw = manifest.personas;
  if (personasRaw === null || typeof personasRaw !== 'object' || Array.isArray(personasRaw)) {
    fail('local test session manifest is invalid');
  }
  const personaRecord = personasRaw as Record<string, unknown>;
  const keys = Object.keys(personaRecord);
  if (keys.length !== LOCAL_TEST_ALIASES.length || LOCAL_TEST_ALIASES.some((alias) => !keys.includes(alias))) {
    fail('local test session manifest is invalid');
  }
  const responsavel = parsePersona('responsavel', personaRecord.responsavel);
  const membro = parsePersona('membro', personaRecord.membro);
  const identities = [
    responsavel.email, membro.email,
    responsavel.sub, membro.sub,
    responsavel.personMdmId, membro.personMdmId,
    responsavel.cmUserId, membro.cmUserId,
  ];
  if (new Set(identities).size !== identities.length) fail('local test session manifest is invalid');

  return {
    enabled: true,
    projectId,
    organizationKey,
    companyMdmId,
    cmOrgId,
    cmTarget,
    storagePrefix,
    allowedOrigins,
    cookieKey,
    personas: { responsavel, membro },
  };
}

function appProjectId(deps: LocalTestConfigDeps): string {
  try {
    return deps.defaultProjectId ? deps.defaultProjectId() : String(readProjectsConfig().defaultProjectId);
  } catch {
    fail('local test session manifest does not match this application');
  }
}

function assertDeclaredTestMode(projectId: string, deps: LocalTestConfigDeps): void {
  if (deps.projectMode) {
    const declared = deps.projectMode(projectId);
    if (!declared.declared || (declared.mode !== 'development' && declared.mode !== 'presentation')) {
      fail('local test session requires a declared development or presentation mode');
    }
    return;
  }
  const mode = readProjectMode(projectId);
  if (!hasDeclaredProjectMode(projectId) || !isTestMode(mode)) {
    fail('local test session requires a declared development or presentation mode');
  }
}

/**
 * Reads the private lima manifest once the flag and the absolute path are both set.
 * Anything else returns disabled without touching the file. Callers that need a fresh
 * file must call `resetLocalTestConfigCache` and reload the process configuration.
 */
export function loadLocalTestConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: LocalTestConfigDeps = {},
): LocalTestConfigState {
  if (!isEnabledFlag(env)) return DISABLED;

  const filePath = (env.LOCAL_TEST_SESSIONS_FILE ?? '').trim();
  if (!filePath || !isAbsolute(filePath) || resolve(filePath) !== filePath) {
    fail('LOCAL_TEST_SESSIONS_FILE must be an absolute path');
  }

  const projectId = appProjectId(deps);
  assertDeclaredTestMode(projectId, deps);
  assertPrivateFile(filePath, deps);
  return parseManifest(readManifest(filePath, deps), projectId);
}

/** Process cache. A changed manifest is picked up only after `resetLocalTestConfigCache`. */
export function getLocalTestConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: LocalTestConfigDeps = {},
): LocalTestConfigState {
  if (!cache) {
    try {
      cache = { state: loadLocalTestConfig(env, deps) };
    } catch (error) {
      cache = {
        error: error instanceof LocalTestConfigError
          ? error
          : new LocalTestConfigError('local test session manifest is invalid'),
      };
    }
  }
  if ('error' in cache) throw cache.error;
  return cache.state;
}

export function resetLocalTestConfigCache(): void {
  cache = undefined;
}

/** Server-side resolution by alias, email or sub. Ids from the browser are ignored. */
export function lookupLocalTestPersona(
  query: { alias?: string; email?: string; sub?: string },
  state: LocalTestConfigState = getLocalTestConfig(),
): LocalTestPersona | null {
  if (!state.enabled) return null;
  const personas = LOCAL_TEST_ALIASES.map((alias) => state.personas[alias]);
  const matches = personas.filter((persona) => {
    if (query.alias !== undefined && persona.alias !== query.alias) return false;
    if (query.email !== undefined && persona.email !== query.email) return false;
    if (query.sub !== undefined && persona.sub !== query.sub) return false;
    return query.alias !== undefined || query.email !== undefined || query.sub !== undefined;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The proxy calls this with the target it is about to use.
 * A disabled bench or any other destination refuses, and the message carries no secret.
 */
export function assertLocalTestProxyTarget(
  effectiveTarget: string,
  state: LocalTestConfigState = getLocalTestConfig(),
): void {
  if (!state.enabled) fail('local test session is disabled');
  const normalized = effectiveTarget.trim().replace(/\/+$/u, '');
  if (normalized !== state.cmTarget) fail('local test session proxy target is refused');
}
