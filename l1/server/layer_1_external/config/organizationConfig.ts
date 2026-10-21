/// <mls fileReference="_102034_/l1/server/layer_1_external/config/organizationConfig.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';

import type { ProjectOrganizationConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { readProjectFile } from '../cbe/cbeLogin.js';
import { resolveProjectDistPath } from './projectConfig.js';
import { readProjectMode, type ProjectMode } from './projectMode.js';
import { OnboardingConfigError, readOnboardingConfig } from './onboardingConfig.js';

export interface OrganizationBinding {
  key: string;
  name: string;
  source: 'project-file' | 'development-project';
}

type SitesProjectFile = NonNullable<ReturnType<typeof readProjectFile>>;

export interface OrganizationBindingIo {
  readProjectFile: (projectId: number) => SitesProjectFile | null;
  readProjectMode: (projectId: string) => ProjectMode;
  readL5Project: (projectId: string) => { orgName?: unknown };
}

const DEVELOPMENT_MODES: ReadonlySet<ProjectMode> = new Set(['development', 'presentation']);

type OrganizationSource = 'project-file' | 'development-project';

function readL5Project(projectId: string): { orgName?: unknown } {
  const projectPath = resolveProjectDistPath(`_${projectId}_/l5/project.json`);
  if (!existsSync(projectPath)) {
    throw new OnboardingConfigError(`l5/project.json not found for client ${projectId}`);
  }
  try {
    return JSON.parse(readFileSync(projectPath, 'utf8')) as { orgName?: unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OnboardingConfigError(`l5/project.json unreadable for client ${projectId}: ${message}`);
  }
}

function developmentBinding(orgName: unknown): OrganizationBinding {
  if (typeof orgName !== 'string') {
    throw new OnboardingConfigError('l5/project.json orgName must be a non-empty string');
  }
  const trimmed = orgName.trim();
  if (trimmed.length === 0 || trimmed === '[org]') {
    throw new OnboardingConfigError('l5/project.json orgName is empty or the [org] placeholder');
  }
  const normalized = trimmed.normalize('NFKC').toLowerCase();
  if (normalized.length === 0 || normalized === '[org]') {
    throw new OnboardingConfigError('l5/project.json orgName is empty or the [org] placeholder');
  }
  return { key: `development-org:${normalized}`, name: orgName, source: 'development-project' };
}

function bindingFromProjectFile(clientId: string, file: SitesProjectFile): OrganizationBinding {
  const orgId = typeof file.org?.orgId === 'string' ? file.org.orgId.trim() : '';
  if (orgId.length === 0) {
    throw new OnboardingConfigError(`project file for client ${clientId} has no org.orgId`);
  }
  const declaredProjectId = file.project?.projectId;
  if (declaredProjectId != null && String(declaredProjectId).length > 0 && String(declaredProjectId) !== clientId) {
    throw new OnboardingConfigError(`project file projectId '${String(declaredProjectId)}' does not match client ${clientId}`);
  }
  const name = file.org?.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new OnboardingConfigError(`project file for client ${clientId} has no org.name`);
  }
  return { key: `org:${orgId}`, name, source: 'project-file' };
}

function explicitSource(organization: ProjectOrganizationConfig): OrganizationSource {
  if (organization == null || typeof organization !== 'object' || Array.isArray(organization)) {
    throw new OnboardingConfigError('organization must be an object when present');
  }
  if (organization.source === undefined) return 'project-file';
  if (organization.source !== 'project-file' && organization.source !== 'development-project') {
    throw new OnboardingConfigError(`organization.source '${String(organization.source)}' is not supported`);
  }
  return organization.source;
}

/**
 * Source when `organization` was omitted.
 * No onboarding and no explicit field is the legacy preview: a sites file still binds, otherwise null.
 * Present onboarding keeps its validated organizationSource (absent means project-file).
 */
function legacySource(config: ProjectsConfig): OrganizationSource | null {
  const onboarding = readOnboardingConfig(config);
  if (!onboarding) return null;
  return onboarding.organizationSource === 'development-project' ? 'development-project' : 'project-file';
}

/**
 * Resolves the organization of config.defaultProjectId (the client), never the master that served the module.
 * A valid sites project file wins. A name fallback exists only when the effective source is development-project
 * and the client mode is development or presentation. The key stays org:<orgId> or development-org:<NFKC lower>.
 * An explicit organization field is not allowed to read or validate the cadastro module.
 * With neither organization nor onboarding, a missing file returns null and does not invent an organization.
 */
export function resolveOrganizationBinding(config: ProjectsConfig, io?: Partial<OrganizationBindingIo>): OrganizationBinding | null {
  const explicit = config.organization !== undefined;
  const source = explicit ? explicitSource(config.organization as ProjectOrganizationConfig) : legacySource(config);

  const clientId = config.defaultProjectId;
  if (typeof clientId !== 'string' || !/^\d+$/.test(clientId)) {
    throw new OnboardingConfigError(`defaultProjectId '${String(clientId)}' is not a client project id`);
  }

  const file = (io?.readProjectFile ?? readProjectFile)(Number(clientId));
  if (file) return bindingFromProjectFile(clientId, file);

  if (source == null) return null;

  if (source !== 'development-project') {
    throw new OnboardingConfigError(`organization source for client ${clientId} is not available: project file is absent`);
  }

  const mode = (io?.readProjectMode ?? readProjectMode)(clientId);
  if (!DEVELOPMENT_MODES.has(mode)) {
    throw new OnboardingConfigError(`organization name fallback is refused in mode '${mode}'`);
  }

  const l5 = (io?.readL5Project ?? readL5Project)(clientId);
  return developmentBinding(l5.orgName);
}
