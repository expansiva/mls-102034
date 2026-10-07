/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLogin.ts" enhancement="_blank" />
// Local (runtime VM) implementation of the cbe `login` action. It answers with
// the same ResponseLogin shape the cfe (mls) frontend consumes on the studio,
// but scoped to this workspace: a single synthetic org ("local") containing the
// workspace projects, with incremental compiled-sources delivery based on the
// projectsLastModified control sent by the frontend.
//
// No authentication yet: this is the anonymous bootstrap. The collab-auth JWT
// session (cauth cookie + JWKS validation) plugs in here later without changing
// the response shape.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getFilesIfNewer, getProjectsBaseDir, hasCompiledZip, resolveProjectSourcePath } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import {
  CBE_HTTP_OK,
  type CbeOrgInfo,
  type CbePrjSettings,
  type CbeProjectsLastModified,
  type CbeRequestLogin,
  type CbeResponseLogin,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';
import type { ProjectSettingsConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';

const LOCAL_ORG_NAME = 'local';
const LOCAL_OWNER = 'local';
const DEFAULT_PROJECT_DRIVER = 'vm';
const DEFAULT_PROJECT_URL = `${LOCAL_OWNER}/${LOCAL_OWNER}/${LOCAL_OWNER}`;
/** Lowest id the platform assigns — anything below it is not a project (same floor cbeMiniCfe uses). */
const MIN_PROJECT_ID = 100000;

// ── Project file (written by the sites, read-only here; sites_03 v1 schema) ──
// Source of truth for the project's org and created_at, mounted on the VM at
// /etc/collab/projects/<projectId>.json. A missing file is the normal case for
// the workspace dependencies (mls-102029 etc.) and for dev/lima, which the
// sites never writes for. v2 only adds fields, which this reader ignores.

interface ProjectFileV1 {
  schema: number;
  generatedAt: string;
  org: { orgId: string; slug: string; name: string; createdAt: string };
  project: { projectId: string; domain: string; appEnv: string | null; language: string | null; type: string; createdAt: string };
}

interface ProjectFileCacheEntry {
  mtimeMs: number;
  /** null when the file is invalid (the error for this mtime has already been logged). */
  data: ProjectFileV1 | null;
}

const projectFileCache = new Map<number, ProjectFileCacheEntry>();
let warnedNoProjectFile = false;
let lastMixedOrgWarnKey: string | null = null;

function getProjectFilesDir(): string {
  return process.env.CBE_PROJECT_FILES_DIR ?? '/etc/collab/projects';
}

function getProjectFilePath(projectId: number): string {
  return join(getProjectFilesDir(), `${projectId}.json`);
}

function isValidProjectFile(parsed: unknown): parsed is ProjectFileV1 {
  if (!parsed || typeof parsed !== 'object') return false;
  const schema = (parsed as { schema?: unknown }).schema;
  if (typeof schema !== 'number' || schema < 1) return false;
  const org = (parsed as { org?: unknown }).org;
  if (!org || typeof org !== 'object') return false;
  const { slug, name } = org as { slug?: unknown; name?: unknown };
  return typeof slug === 'string' && slug.length > 0 && typeof name === 'string' && name.length > 0;
}

/**
 * Reads the project file the sites writes at `getProjectFilesDir()`, cached by
 * mtime like the compiled.zip (cbeCompiledLocal.ts). Missing is normal and does
 * not log. Invalid (broken JSON, or schema/org.slug/org.name missing or
 * malformed) logs a console.error with the path and is treated as missing —
 * once per mtime, since an unchanged mtime returns the cached result without
 * re-parsing.
 */
export function readProjectFile(projectId: number): ProjectFileV1 | null {
  const filePath = getProjectFilePath(projectId);
  if (!existsSync(filePath)) return null;

  const mtimeMs = statSync(filePath).mtimeMs;
  const cached = projectFileCache.get(projectId);
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;

  let data: ProjectFileV1 | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (isValidProjectFile(parsed)) {
      data = parsed;
    } else {
      console.error(`[cbe] project ${projectId}: project file invalid at ${filePath} — schema/org.slug/org.name missing or malformed, treated as absent`);
    }
  } catch (err) {
    console.error(`[cbe] project ${projectId}: project file unreadable at ${filePath} — ${(err as Error).message}, treated as absent`);
  }

  projectFileCache.set(projectId, { mtimeMs, data });
  return data;
}

function warnNoProjectFileOnce(): void {
  if (warnedNoProjectFile) return;
  warnedNoProjectFile = true;
  console.warn(`[cbe] no project file under ${getProjectFilesDir()} — org '${LOCAL_ORG_NAME}'`);
}

/**
 * One org per VM (the sites guarantees it via assertProjectBelongsToOrg). The
 * org comes from the valid project files of the servable projects: all with
 * the same org.orgId resolve to that org; files with different org.orgId log
 * a console.error (once per set of mtimes) and fall back to 'local'; no valid
 * file logs a single console.warn per process and falls back to 'local'.
 */
export function resolveOrgInfo(projectIds: number[]): { slug: string; name: string; createdAt: string } {
  const entries = projectIds
    .map((id) => ({ id, file: readProjectFile(id) }))
    .filter((entry): entry is { id: number; file: ProjectFileV1 } => entry.file !== null);

  if (entries.length === 0) {
    warnNoProjectFileOnce();
    return { slug: LOCAL_ORG_NAME, name: LOCAL_ORG_NAME, createdAt: '' };
  }

  const orgIds = new Set(entries.map((entry) => entry.file.org.orgId));
  if (orgIds.size > 1) {
    const key = entries
      .map((entry) => `${entry.id}:${projectFileCache.get(entry.id)?.mtimeMs}`)
      .sort()
      .join(',');
    if (lastMixedOrgWarnKey !== key) {
      lastMixedOrgWarnKey = key;
      const detail = entries
        .map((entry) => `project ${entry.id} (org ${entry.file.org.orgId}) at ${getProjectFilePath(entry.id)}`)
        .join(', ');
      console.error(`[cbe] project files report different org ids — ${detail} — falling back to org '${LOCAL_ORG_NAME}'`);
    }
    return { slug: LOCAL_ORG_NAME, name: LOCAL_ORG_NAME, createdAt: '' };
  }

  const { org } = entries[0].file;
  return { slug: org.slug, name: org.name, createdAt: org.createdAt };
}

function readProjectDependencies(projectId: number): number[] {
  const configPath = resolveProjectSourcePath(projectId, 'l5/config.json');
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      workspaceDependencies?: string[] | Record<string, unknown>;
    };
    const declared = parsed.workspaceDependencies ?? [];
    // Today it is an ARRAY of ids (["102029","102033",...]). Object.keys on an array
    // yields its INDEXES, which silently produced project ids 1..8 — hence the map
    // over the array itself, with the object form kept for older configs.
    const ids = Array.isArray(declared) ? declared : Object.keys(declared);
    return ids
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id >= MIN_PROJECT_ID && id !== projectId);
  } catch (err) {
    console.error(
      `[cbe] project ${projectId}: l5/config.json unreadable at ${configPath} — dependencies ignored: ${(err as Error).message}`,
    );
    return [];
  }
}

function readProjectName(projectId: number): string {
  const projectJsonPath = resolveProjectSourcePath(projectId, 'l5/project.json');
  if (existsSync(projectJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as { name?: string };
      if (parsed.name && typeof parsed.name === 'string') return parsed.name;
    } catch {
      // fall through to the default name
    }
  }
  return `mls-${projectId}`;
}

function defaultProjectSettings(): ProjectSettingsConfig {
  return { driver: DEFAULT_PROJECT_DRIVER, url: DEFAULT_PROJECT_URL };
}

function warnProjectSettingsAbsent(projectId: number): ProjectSettingsConfig {
  console.warn(`[cbe] project ${projectId}: projectSettings absent — using default`);
  return defaultProjectSettings();
}

/** Last-three-segment count used by getMyKeysBranch (trailing slash stripped once). */
function projectUrlSegmentCount(url: string): number {
  const trimmed = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  return trimmed.split('/').length;
}

export function readProjectSettings(projectId: number): ProjectSettingsConfig {
  const configPath = resolveProjectSourcePath(projectId, 'l5/config.json');
  if (!existsSync(configPath)) return warnProjectSettingsAbsent(projectId);
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as ProjectsConfig;
    const block = parsed.projectSettings;
    if (!block || typeof block.driver !== 'string' || !block.driver || typeof block.url !== 'string' || !block.url) {
      return warnProjectSettingsAbsent(projectId);
    }
    if (projectUrlSegmentCount(block.url) < 3) {
      console.warn(`[cbe] project ${projectId}: projectSettings.url rejected — getMyKeysBranch needs >= 3 '/'-separated segments — using default`);
      return defaultProjectSettings();
    }
    return block;
  } catch {
    return warnProjectSettingsAbsent(projectId);
  }
}

/** VM-wide driver announcement. An empty or whitespace-only override is absent. */
export function announcedProjectDriver(settingsDriver: string, env: { CBE_PROJECT_DRIVER_OVERRIDE?: string }): string {
  const override = env.CBE_PROJECT_DRIVER_OVERRIDE?.trim();
  if (override) return override;
  return settingsDriver;
}

export function buildProjectSettings(
  projectId: number,
  projectsLastModified: CbeProjectsLastModified[],
): CbePrjSettings | null {
  const frontendLastModified = projectsLastModified.find((p) => p.project === projectId)?.lastModified;
  const filesInfo = getFilesIfNewer(projectId, frontendLastModified);
  if (!filesInfo) return null;

  const settings = readProjectSettings(projectId);
  const projectFile = readProjectFile(projectId);
  return {
    id: projectId,
    name: settings.name ? settings.name : readProjectName(projectId),
    owner: projectFile ? projectFile.org.slug : LOCAL_OWNER,
    // projectDriver/projectURL come from l5/config.json projectSettings when present;
    // the default below is used otherwise. The cfe rejects 'local'/'mls' in
    // loadProjectInfoIfNeeded, and any other driver is only consulted on an
    // IndexedDB cache miss — which the login always fills first. 'vm' resolves
    // to the VM's own storage driver (see mls-102033/l2/cbe/driverVm.ts),
    // registered in the cfe's 'vm' slot — it never reaches the network.
    // projectURL needs >=3 '/'-separated segments (parsed as .../branch/owner/repo
    // by getMyKeysBranch in mls-102029/l2/libCommom.ts, and mirrored in
    // driverGithub.ts/driverGitlab.ts/driverLib.ts/projects.ts) — a bare 'local'
    // has 1, throwing "Insufficient information to progress" the moment
    // serviceSave.ts's initInfoProject() runs. Three segments keep the same
    // 'local' placeholder convention already used elsewhere on the VM.
    // CBE_PROJECT_DRIVER_OVERRIDE (lima: `vm`) replaces every declared driver: on
    // a VM whose project copies are the source, no file is read from a git host.
    value: JSON.stringify({ projectDriver: announcedProjectDriver(settings.driver, process.env), projectURL: settings.url }),
    created_at: projectFile && typeof projectFile.project?.createdAt === 'string' ? projectFile.project.createdAt : '',
    archived_at: '',
    repository_lastModified: filesInfo.lastModified,
    userAuth: settings.userAuth === 'private' ? 'private' : 'public',
    prj_dependencies: readProjectDependencies(projectId),
    files: filesInfo.files,
  };
}

// All projects the VM can serve: the runtime config set PLUS every mls-<id>
// folder present at the projects base with an obj/compiled.zip. This is what
// makes the studio projects (mls-100554 etc.) — synced by the publish and
// compiled ON the VM (scripts/runtime/buildProjectsObj.mjs) — reach the
// browser, instead of only the runtime workspace of config.json.
function listServableProjectIds(): number[] {
  const ids = new Set<number>();
  const config = readProjectsConfig();
  for (const id of Object.keys(config.projects)) {
    const numeric = Number(id);
    if (Number.isFinite(numeric)) ids.add(numeric);
  }
  try {
    for (const entry of readdirSync(getProjectsBaseDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = /^mls-(\d+)$/u.exec(entry.name);
      if (match) ids.add(Number(match[1]));
    }
  } catch (err) {
    console.warn(`[cbe] projects base scan failed: ${(err as Error).message}`);
  }
  return [...ids].sort((a, b) => a - b);
}

export function executeCbeLogin(args: CbeRequestLogin, loginUser?: string, avatarUrl?: string): CbeResponseLogin {
  const projectsLastModified = Array.isArray(args.projectsLastModified) ? args.projectsLastModified : [];

  const projectIds = listServableProjectIds().filter((id) => hasCompiledZip(id));
  const orgInfo = resolveOrgInfo(projectIds);

  const projects: CbePrjSettings[] = [];
  for (const projectId of projectIds) {
    const settings = buildProjectSettings(projectId, projectsLastModified);
    if (settings) projects.push(settings);
  }

  const org: CbeOrgInfo = {
    key: `org/${orgInfo.slug}`,
    value: '',
    sett: {
      name: orgInfo.name,
      created_at: orgInfo.createdAt,
      description: 'workspace projects served by the local runtime (cbe module)',
      projects,
      users: [loginUser || LOCAL_OWNER],
      teams: [{ name: 'admin', auth: 'admin', usrIndex: [0] }],
    },
    VersionNumber: 1,
  };

  const sentFiles = projects.filter((p) => p.files).map((p) => p.id);
  console.info(`[cbe] login (${loginUser || 'anonymous'}): ${projects.length} project(s), files sent for [${sentFiles.join(', ')}]`);

  return {
    statusCode: CBE_HTTP_OK,
    msg: 'ok',
    services: [],
    orgs: { [orgInfo.slug]: org },
    inits: {},
    providers: [],
    // OIDC picture claim from the JWT session ('' for the test user/anonymous).
    avatar_url: avatarUrl ?? '',
    baseProject: args.baseProject ?? 0,
    alertMessage: '',
    errorMessage: '',
  };
}
