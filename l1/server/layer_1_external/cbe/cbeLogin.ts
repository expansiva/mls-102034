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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

const LOCAL_ORG_NAME = 'local';
const LOCAL_OWNER = 'local';
/** Lowest id the platform assigns — anything below it is not a project (same floor cbeMiniCfe uses). */
const MIN_PROJECT_ID = 100000;

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
  } catch {
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

function buildProjectSettings(
  projectId: number,
  projectsLastModified: CbeProjectsLastModified[],
): CbePrjSettings | null {
  const frontendLastModified = projectsLastModified.find((p) => p.project === projectId)?.lastModified;
  const filesInfo = getFilesIfNewer(projectId, frontendLastModified);
  if (!filesInfo) return null;

  return {
    id: projectId,
    name: readProjectName(projectId),
    owner: LOCAL_OWNER,
    // projectDriver marker: the cfe rejects 'local'/'mls' in
    // loadProjectInfoIfNeeded, and any other driver is only consulted on an
    // IndexedDB cache miss — which the login always fills first. 'GitHub' here
    // never reaches the network on the VM; a dedicated 'vm' driver in the cfe
    // can replace this marker later.
    value: JSON.stringify({ projectDriver: 'GitHub', projectURL: 'local' }),
    created_at: '',
    archived_at: '',
    repository_lastModified: filesInfo.lastModified,
    userAuth: 'public',
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

export function executeCbeLogin(args: CbeRequestLogin, loginUser?: string): CbeResponseLogin {
  const projectsLastModified = Array.isArray(args.projectsLastModified) ? args.projectsLastModified : [];

  const projectIds = listServableProjectIds().filter((id) => hasCompiledZip(id));

  const projects: CbePrjSettings[] = [];
  for (const projectId of projectIds) {
    const settings = buildProjectSettings(projectId, projectsLastModified);
    if (settings) projects.push(settings);
  }

  const org: CbeOrgInfo = {
    key: `org/${LOCAL_ORG_NAME}`,
    value: '',
    sett: {
      name: LOCAL_ORG_NAME,
      created_at: '',
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
    orgs: { [LOCAL_ORG_NAME]: org },
    inits: {},
    providers: [],
    avatar_url: '',
    baseProject: args.baseProject ?? 0,
    alertMessage: '',
    errorMessage: '',
  };
}
