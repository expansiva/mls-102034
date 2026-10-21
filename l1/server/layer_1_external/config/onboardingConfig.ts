/// <mls fileReference="_102034_/l1/server/layer_1_external/config/onboardingConfig.ts" enhancement="_blank" />
import { isAbsolute } from 'node:path';

import type { ProjectOnboardingConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';

export type { OrganizationBinding, OrganizationBindingIo } from './organizationConfig.js';
export { resolveOrganizationBinding } from './organizationConfig.js';

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
