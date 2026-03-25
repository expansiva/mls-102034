/// <mls fileReference="_102034_/l1/server/layer_1_external/frontend/appRegistry.ts" enhancement="_blank" />
import { dirname } from 'node:path';
import type {
  DeviceKind,
  FrontendAppLayout,
  FrontendAppRegistration,
  FrontendModuleShellPreferences,
  FrontendRouteRegistration,
} from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  getPublicationTarget,
  readProjectsConfig,
  resolveActivePublicationDistPath,
  resolveProjectDistPath,
  resolveProjectModuleImportUrl,
  toPublishedAssetUrl,
} from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

interface LoadedModuleUiDefinition {
  pageTitle?: string;
  device?: DeviceKind;
  navigation?: FrontendAppRegistration['navigation'];
  routes: FrontendRouteRegistration[];
  headerRenderer?: FrontendAppRegistration['headerRenderer'];
  asideRenderer?: FrontendAppRegistration['asideRenderer'];
}

const moduleDefinitionCache = new Map<string, Promise<LoadedModuleUiDefinition | undefined>>();
let cachedAppsPromise: Promise<FrontendAppRegistration[]> | null = null;

function toPublicImportPath(importPath: string) {
  const normalized = importPath.startsWith('./') ? `/${importPath.slice(2)}` : importPath;
  return toPublishedAssetUrl(normalized);
}

function createDefaultLayout(): FrontendAppLayout {
  return {
    regions: {
      desktop: {
        header: true,
        aside: true,
        content: true,
      },
      mobile: {
        header: true,
        aside: true,
        content: true,
      },
    },
    asideMode: {
      desktop: 'inline',
      mobile: 'drawer',
    },
  };
}

function mergeLayoutPreferences(preferences?: FrontendModuleShellPreferences): FrontendAppLayout {
  const defaults = createDefaultLayout();
  return {
    regions: {
      desktop: {
        ...defaults.regions.desktop,
        ...(preferences?.layout?.regions?.desktop ?? {}),
      },
      mobile: {
        ...defaults.regions.mobile,
        ...(preferences?.layout?.regions?.mobile ?? {}),
      },
    },
    asideMode: {
      ...defaults.asideMode,
      ...(preferences?.layout?.asideMode ?? {}),
    },
  };
}

function normalizeRendererConfig(renderer?: { entrypoint: string; tag: string }) {
  if (!renderer?.entrypoint || !renderer.tag) {
    return undefined;
  }
  return {
    entrypoint: toPublicImportPath(renderer.entrypoint),
    tag: renderer.tag,
  };
}

function normalizeRoutes(routes: FrontendRouteRegistration[] | undefined) {
  return (routes ?? []).map((route) => ({
    ...route,
    entrypoint: toPublicImportPath(route.entrypoint),
  }));
}

async function loadModuleDefinition(
  projectId: string,
  moduleId: string,
): Promise<LoadedModuleUiDefinition | undefined> {
  const cacheKey = `${projectId}:${moduleId}`;
  const cached = moduleDefinitionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const moduleUrl = resolveProjectModuleImportUrl(`./_${projectId}_/l2/${moduleId}/module.js`);
      const mod = await import(moduleUrl) as {
        moduleShellPreferences?: FrontendModuleShellPreferences;
        moduleFrontendDefinition?: LoadedModuleUiDefinition;
      };
      if (!mod.moduleFrontendDefinition?.routes?.length) {
        return undefined;
      }

      return {
        ...mod.moduleFrontendDefinition,
        routes: normalizeRoutes(mod.moduleFrontendDefinition.routes),
        headerRenderer: normalizeRendererConfig(mod.moduleFrontendDefinition.headerRenderer),
        asideRenderer: normalizeRendererConfig(mod.moduleFrontendDefinition.asideRenderer),
        device: mod.moduleFrontendDefinition.device ?? 'desktop',
        navigation: mod.moduleFrontendDefinition.navigation ?? [],
      };
    } catch {
      return undefined;
    }
  })();

  moduleDefinitionCache.set(cacheKey, pending);
  return pending;
}

async function loadModuleShellPreferences(
  projectId: string,
  moduleId: string,
): Promise<FrontendModuleShellPreferences | undefined> {
  try {
    const moduleUrl = resolveProjectModuleImportUrl(`./_${projectId}_/l2/${moduleId}/module.js`);
    const mod = await import(moduleUrl) as { moduleShellPreferences?: FrontendModuleShellPreferences };
    return mod.moduleShellPreferences;
  } catch {
    return undefined;
  }
}

function collectRoutePatterns(routes: FrontendRouteRegistration[]) {
  return [...new Set(routes.flatMap((route) => [route.path, ...(route.aliases ?? [])]))];
}

async function getConfiguredFrontendApps(): Promise<FrontendAppRegistration[]> {
  const config = readProjectsConfig();
  const publicationTarget = getPublicationTarget();
  const sharedAssetRoots = publicationTarget.serveStaticFromServer
    ? Object.keys(config.projects).map((projectId) => resolveActivePublicationDistPath(`./_${projectId}_/l2`))
    : Object.keys(config.projects).map((projectId) => resolveProjectDistPath(`./_${projectId}_/l2`));

  const configuredProjects = Object.entries(config.projects) as Array<[string, import('/_102034_/l1/server/layer_1_external/config/projectConfig.js').ProjectConfigRecord]>;
  const maybeApps: Array<FrontendAppRegistration | null> = await Promise.all(configuredProjects.flatMap(([projectId, project]) =>
    (project.modules ?? []).map(async (moduleConfig) => {
      const [moduleDefinition, modulePreferences] = await Promise.all([
        loadModuleDefinition(projectId, moduleConfig.moduleId),
        loadModuleShellPreferences(projectId, moduleConfig.moduleId),
      ]);
      if (!moduleDefinition) {
        return null;
      }

      const app: FrontendAppRegistration = {
        projectId,
        appId: moduleConfig.moduleId,
        basePath: moduleConfig.basePath,
        indexHtmlPath: resolveActivePublicationDistPath(config.shellTemplates[moduleConfig.shellMode]),
        assetRoots: sharedAssetRoots,
        routePatterns: collectRoutePatterns(moduleDefinition.routes),
        shellMode: moduleConfig.shellMode,
        routes: moduleDefinition.routes,
        headerRenderer: moduleDefinition.headerRenderer,
        asideRenderer: moduleDefinition.asideRenderer,
        layout: mergeLayoutPreferences(modulePreferences),
        device: moduleDefinition.device ?? 'desktop',
        pageTitle: moduleDefinition.pageTitle ?? moduleConfig.moduleId,
        navigation: moduleDefinition.navigation ?? [],
      };

      return app;
    })));

  const apps = maybeApps.filter((app): app is FrontendAppRegistration => app !== null);

  return apps.map((app) => ({
    ...app,
    moduleLinks: apps
      .filter((candidate) => candidate.basePath !== app.basePath)
      .map((candidate) => ({
        id: candidate.appId,
        label: candidate.pageTitle ?? candidate.appId,
        href: candidate.basePath,
        description: `Open ${candidate.pageTitle ?? candidate.appId}`,
      })),
  }));
}

export async function getFrontendAppRegistrations() {
  if (!cachedAppsPromise) {
    cachedAppsPromise = getConfiguredFrontendApps();
  }
  return cachedAppsPromise;
}

export async function getFrontendAppByBasePath(urlPath: string) {
  const apps = await getFrontendAppRegistrations();
  return apps.find((app) => urlPath === app.basePath || urlPath.startsWith(`${app.basePath}/`));
}

export function getAppPublicRootDir(app: FrontendAppRegistration) {
  return dirname(app.indexHtmlPath);
}
