/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/configHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { getFrontendAppRegistrations } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';

// Returns the composed workspace config.json (ProjectsConfig) so the monitor can display it
// read-only for inspection — e.g. clientShell.regions.*.profiles used by mls.sites. The file
// carries topology only (no passwords/secrets — those live in .env).
export const monitorConfigLoadHandler: BffHandler = async () => ok(readProjectsConfig());

// Apps menu source for the frontend (collab-messages Apps tab): every hosted
// app with its RESOLVED navigation. Unlike config.json, this includes the
// master modules (monitor/audit/mdm), whose navigation lives in their
// module.ts moduleFrontendDefinition, not in the composed config.
export const monitorAppsMenuHandler: BffHandler = async () => {
  const apps = await getFrontendAppRegistrations();
  return ok({
    apps: apps.map((app) => ({
      projectId: app.projectId,
      moduleId: app.appId,
      basePath: app.basePath,
      navigation: app.navigation ?? [],
    })),
  });
};
