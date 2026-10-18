/// <mls fileReference="_102034_/l1/server/layer_1_external/config/onboardingConfig.ts" enhancement="_blank" />
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { ProjectOnboardingConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { readProjectFile } from '../cbe/cbeLogin.js';
import { resolveProjectDistPath } from './projectConfig.js';
import { readProjectMode, type ProjectMode } from './projectMode.js';

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

export class OnboardingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingConfigError';
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OnboardingConfigError(`onboarding.${field} must be a non-empty string`);
  }
  return value;
}

function assertLocalEntryPath(entryPath: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(entryPath)) {
    throw new OnboardingConfigError(`onboarding.entryPath rejects an external origin: ${entryPath}`);
  }
  if (entryPath.includes('//')) {
    throw new OnboardingConfigError('onboarding.entryPath must be a local path without //');
  }
  if (!isAbsolute(entryPath)) {
    throw new OnboardingConfigError('onboarding.entryPath must be an absolute local path');
  }
}

/** Returns null when onboarding is omitted. Throws when the block is present but incomplete. */
export function readOnboardingConfig(config: Pick<ProjectsConfig, 'onboarding'> | null | undefined): ProjectOnboardingConfig | null {
  if (config == null || config.onboarding == null) return null;
  const raw = config.onboarding;
  if (typeof raw !== 'object') {
    throw new OnboardingConfigError('onboarding must be an object when present');
  }
  const moduleId = requiredText(raw.moduleId, 'moduleId');
  const entryPath = requiredText(raw.entryPath, 'entryPath');
  const personType = requiredText(raw.personType, 'personType');
  const companyType = requiredText(raw.companyType, 'companyType');
  assertLocalEntryPath(entryPath);
  let organizationSource: ProjectOnboardingConfig['organizationSource'];
  if (raw.organizationSource !== undefined) {
    if (raw.organizationSource !== 'project-file' && raw.organizationSource !== 'development-project') {
      throw new OnboardingConfigError(`onboarding.organizationSource '${String(raw.organizationSource)}' is not supported`);
    }
    organizationSource = raw.organizationSource;
  }
  let redirect: boolean | undefined;
  if (raw.redirect !== undefined) {
    if (typeof raw.redirect !== 'boolean') {
      throw new OnboardingConfigError('onboarding.redirect must be a boolean');
    }
    redirect = raw.redirect;
  }
  return { moduleId, entryPath, personType, companyType, organizationSource, redirect };
}

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

/**
 * Resolves the organization of config.defaultProjectId (the client), never the master that served the module.
 * A sites project file wins. A name fallback exists only when organizationSource is development-project
 * and the client mode is development or presentation. That name is a declared dev identity: changing it
 * changes the key, and it is not merged into a production org.
 */
export function resolveOrganizationBinding(config: ProjectsConfig, io?: Partial<OrganizationBindingIo>): OrganizationBinding | null {
  const onboarding = readOnboardingConfig(config);
  if (!onboarding) return null;

  const clientId = config.defaultProjectId;
  if (typeof clientId !== 'string' || !/^\d+$/.test(clientId)) {
    throw new OnboardingConfigError(`defaultProjectId '${String(clientId)}' is not a client project id`);
  }

  const file = (io?.readProjectFile ?? readProjectFile)(Number(clientId));
  if (file) return bindingFromProjectFile(clientId, file);

  if (onboarding.organizationSource !== 'development-project') {
    throw new OnboardingConfigError(`organization source for client ${clientId} is not available: project file is absent`);
  }

  const mode = (io?.readProjectMode ?? readProjectMode)(clientId);
  if (!DEVELOPMENT_MODES.has(mode)) {
    throw new OnboardingConfigError(`organization name fallback is refused in mode '${mode}'`);
  }

  const l5 = (io?.readL5Project ?? readL5Project)(clientId);
  return developmentBinding(l5.orgName);
}
