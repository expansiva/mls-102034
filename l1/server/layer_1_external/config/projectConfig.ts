/// <mls fileReference="_102034_/l1/server/layer_1_external/config/projectConfig.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ProjectType = 'master frontend' | 'master backend' | 'client' | 'lib';

export interface ProjectModuleFrontendEntrypoint {
  entrypoint: string;
  componentTag: string;
}

export interface ProjectPersistenceModuleConfig {
  moduleId: string;
  persistenceEntrypoint: string;
}

export interface ProjectModuleConfig {
  moduleId: string;
  basePath: string;
  shellMode: 'spa' | 'pwa';
  navigation?: Array<{
    id: string;
    label: string;
    href: string;
    description?: string;
  }>;
  frontendEntrypoints?: {
    desktop?: ProjectModuleFrontendEntrypoint;
    mobile?: ProjectModuleFrontendEntrypoint;
  };
  backendRouter?: string;
}

export interface ProjectConfigRecord {
  root: string;
  type?: ProjectType;
  role?: string;
  modules?: ProjectModuleConfig[];
  persistenceModules?: ProjectPersistenceModuleConfig[];
}

export interface PublicationTargetConfig {
  assetBaseUrl?: string;
  serveStaticFromServer?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
}

export interface PublicationConfig {
  defaultTarget: string;
  targets: Record<string, PublicationTargetConfig>;
}

export interface ProjectsConfig {
  defaultProjectId: string;
  shellTemplates: {
    spa: string;
    pwa: string;
  };
  publication: PublicationConfig;
  projects: Record<string, ProjectConfigRecord>;
}

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

function getProjectsDir() {
  const cwdProjectsConfig = resolve(process.cwd(), 'config.json');
  if (existsSync(cwdProjectsConfig)) {
    return resolve(process.cwd());
  }

  const nestedProjectsConfig = resolve(process.cwd(), 'projects', 'config.json');
  if (existsSync(nestedProjectsConfig)) {
    return resolve(process.cwd(), 'projects');
  }

  return resolve(process.cwd());
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
  const normalized = relativePath.replace(/^\.\//u, '');
  const match = normalized.match(/^_(\d+)_\/(.*)$/u);
  if (!match) {
    return resolve(getProjectsDir(), 'dist', 'local', normalized);
  }

  const [, projectId, rest] = match;
  return resolve(getProjectsDir(), 'dist', 'local', `_${projectId}_`, rest);
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
  const normalized = relativePath.replace(/^\.\//u, '');
  if (!normalized || normalized === '.') {
    return resolve(getProjectsDir(), 'dist', targetName);
  }
  return resolve(getProjectsDir(), 'dist', targetName, normalized);
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
