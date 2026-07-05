/// <mls fileReference="_102034_/l1/server/layer_1_external/config/projectConfig.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ProjectConfigRecord,
  ProjectType,
  ProjectsConfig,
  PublicationConfig,
} from '/_102029_/l2/runtimeConfigTypes.js';

// Config types are shared, master-agnostic contracts hosted by 102029 (they are also
// used by the publish composers). Re-exported here to keep this module's public API.
export type {
  ProjectClientShellConfig,
  ProjectConfigRecord,
  ProjectDynamicRegionConfig,
  ProjectFrontendPageConfig,
  ProjectModuleConfig,
  ProjectModuleFrontendConfig,
  ProjectModuleFrontendEntrypoint,
  ProjectNavigationEntry,
  ProjectPersistenceModuleConfig,
  ProjectRegionRendererConfig,
  ProjectShellRegionProfiles,
  ProjectType,
  ProjectsConfig,
  PublicationConfig,
  PublicationTargetConfig,
} from '/_102029_/l2/runtimeConfigTypes.js';

let cachedConfig: ProjectsConfig | null = null;

function normalizeProjectType(project: ProjectConfigRecord): ProjectType {
  if (project.type) {
    return project.type;
  }

  switch (project.role) {
    case 'frontend_base':
      return 'master frontend';
    case 'server_core':
      return 'master backend';
    case 'client_project':
      return 'client';
    default:
      return 'lib';
  }
}

function validateProjectsConfig(config: ProjectsConfig) {
  const projects = Object.entries(config.projects);
  const clients = projects.filter(([, project]) => project.type === 'client');
  const masterFrontends = projects.filter(([, project]) => project.type === 'master frontend');
  const masterBackends = projects.filter(([, project]) => project.type === 'master backend');

  if (clients.length !== 1) {
    throw new Error(`Workspace must declare exactly 1 project of type "client". Found ${clients.length}.`);
  }

  if (masterFrontends.length === 0) {
    throw new Error('Workspace must declare at least 1 project of type "master frontend".');
  }

  if (masterBackends.length === 0) {
    throw new Error('Workspace must declare at least 1 project of type "master backend".');
  }

  if (!config.projects[config.defaultProjectId]) {
    throw new Error(`defaultProjectId "${config.defaultProjectId}" is not declared in projects/config.json.`);
  }

  if (!config.publication?.targets || Object.keys(config.publication.targets).length === 0) {
    throw new Error('projects/config.json must declare at least one publication target.');
  }

  if (!config.publication.targets[config.publication.defaultTarget]) {
    throw new Error(
      `publication.defaultTarget "${config.publication.defaultTarget}" is not declared in projects/config.json.`,
    );
  }
}

function normalizeAssetBaseUrl(assetBaseUrl: string | undefined) {
  if (!assetBaseUrl) {
    return '';
  }

  return assetBaseUrl.replace(/\/+$/u, '');
}

function getDefaultPublicationConfig(): PublicationConfig {
  return {
    defaultTarget: 'local',
    targets: {
      local: {
        assetBaseUrl: '',
        serveStaticFromServer: true,
        minify: false,
        sourcemap: true,
      },
      cdncloudflare: {
        assetBaseUrl: 'https://cdn.example.com',
        serveStaticFromServer: false,
        minify: true,
        sourcemap: false,
      },
    },
  };
}

function normalizeProjectsConfig(config: ProjectsConfig): ProjectsConfig {
  const normalizedProjects = Object.fromEntries(
    Object.entries(config.projects).map(([projectId, project]) => [
      projectId,
      {
        ...project,
        type: normalizeProjectType(project),
      },
    ]),
  ) as ProjectsConfig['projects'];

  const normalizedConfig: ProjectsConfig = {
    ...config,
    projects: normalizedProjects,
    publication: {
      ...getDefaultPublicationConfig(),
      ...config.publication,
      targets: Object.fromEntries(
        Object.entries({
          ...getDefaultPublicationConfig().targets,
          ...(config.publication?.targets ?? {}),
        }).map(([targetName, targetConfig]) => [
          targetName,
          {
            ...targetConfig,
            assetBaseUrl: normalizeAssetBaseUrl(targetConfig.assetBaseUrl),
          },
        ]),
      ),
    },
  };

  validateProjectsConfig(normalizedConfig);
  return normalizedConfig;
}

function isProjectsConfigFile(configPath: string) {
  if (!existsSync(configPath)) {
    return false;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<ProjectsConfig>;
    return typeof config.defaultProjectId === 'string' && !!config.projects && typeof config.projects === 'object';
  } catch {
    return false;
  }
}

function findProjectsDir(startDir = process.cwd()) {
  let current = resolve(startDir);

  while (true) {
    const cwdProjectsConfig = resolve(current, 'config.json');
    if (isProjectsConfigFile(cwdProjectsConfig)) {
      return current;
    }

    const nestedProjectsConfig = resolve(current, 'projects', 'config.json');
    if (isProjectsConfigFile(nestedProjectsConfig)) {
      return resolve(current, 'projects');
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDir);
    }
    current = parent;
  }
}

function getProjectsDir() {
  return findProjectsDir();
}

export function projectsConfigExists() {
  return existsSync(resolve(getProjectsDir(), 'config.json'));
}

function normalizeVirtualPath(relativePath: string) {
  return relativePath.replace(/^\.\//u, '').replace(/^\/+/u, '');
}

function resolveProjectSourcePath(relativePath: string): string | null {
  const normalized = normalizeVirtualPath(relativePath);
  const match = normalized.match(/^_(\d+)_\/(.*)$/u);
  if (!match) {
    return null;
  }

  const [, projectId, rest] = match;
  const base = resolve(getProjectsDir(), `mls-${projectId}`, rest);
  const candidates = [base];
  if (extname(base) === '.js') {
    candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  }
  if (!extname(base)) {
    candidates.push(base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'));
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function withSourceFallback(distPath: string, relativePath: string) {
  if (existsSync(distPath)) {
    return distPath;
  }

  return resolveProjectSourcePath(relativePath) ?? distPath;
}

export function readProjectsConfig(): ProjectsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = resolve(getProjectsDir(), 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`projects/config.json not found at ${configPath}`);
  }

  cachedConfig = normalizeProjectsConfig(JSON.parse(readFileSync(configPath, 'utf8')) as ProjectsConfig);
  return cachedConfig;
}

export function resetProjectsConfigCache() {
  cachedConfig = null;
}

export function resolveProjectsPath(relativePath: string) {
  return resolve(getProjectsDir(), relativePath);
}

export function resolveProjectDistPath(relativePath: string) {
  const normalized = normalizeVirtualPath(relativePath);
  const match = normalized.match(/^_(\d+)_\/(.*)$/u);
  if (!match) {
    return withSourceFallback(
      resolve(getProjectsDir(), 'dist', 'local', normalized),
      normalized,
    );
  }

  const [, projectId, rest] = match;
  return withSourceFallback(
    resolve(getProjectsDir(), 'dist', 'local', `_${projectId}_`, rest),
    normalized,
  );
}

export function getPublicationTarget(targetName?: string) {
  const config = readProjectsConfig();
  const resolvedTargetName = targetName ?? config.publication.defaultTarget;
  const target = config.publication.targets[resolvedTargetName];

  if (!target) {
    throw new Error(`Unknown publication target "${resolvedTargetName}".`);
  }

  return {
    name: resolvedTargetName,
    ...target,
    assetBaseUrl: normalizeAssetBaseUrl(target.assetBaseUrl),
  };
}

export function resolvePublicationDistPath(targetName: string, relativePath = '.') {
  const normalized = normalizeVirtualPath(relativePath);
  if (!normalized || normalized === '.') {
    return resolve(getProjectsDir(), 'dist', targetName);
  }
  const distPath = resolve(getProjectsDir(), 'dist', targetName, normalized);
  if (targetName !== 'local') {
    return distPath;
  }
  return withSourceFallback(distPath, normalized);
}

export function resolveActivePublicationDistPath(relativePath = '.') {
  return resolvePublicationDistPath(getPublicationTarget().name, relativePath);
}

export function toPublishedAssetUrl(relativePath: string, targetName?: string) {
  const normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath.replace(/^\.\//u, '')}`;
  const target = getPublicationTarget(targetName);
  return target.assetBaseUrl ? `${target.assetBaseUrl}${normalizedPath}` : normalizedPath;
}

export function resolveProjectModuleImportUrl(relativePath: string) {
  return pathToFileURL(resolveProjectDistPath(relativePath)).href;
}
