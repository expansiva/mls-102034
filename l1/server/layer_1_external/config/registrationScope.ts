/// <mls fileReference="_102034_/l1/server/layer_1_external/config/registrationScope.ts" enhancement="_blank" />
import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readOnboardingConfig, resolveOrganizationBinding, type OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { readProjectsConfig } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';

export function loadRegistrationScope(): {
  projectId: string;
  binding: OrganizationBinding;
  config: ProjectOnboardingConfig;
} {
  const projects = readProjectsConfig();
  const config = readOnboardingConfig(projects);
  const binding = config ? resolveOrganizationBinding(projects) : null;
  if (!config || !binding) {
    throw new AppError('NOT_AVAILABLE', 'onboarding is not enabled', 404);
  }
  return { projectId: projects.defaultProjectId, binding, config };
}
