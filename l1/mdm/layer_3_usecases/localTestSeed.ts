/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/localTestSeed.ts" enhancement="_blank" />
import type { ProjectOnboardingConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { readOnboardingConfig, type OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { ensureOrganizationCompany } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { ensureSelfRegistration, personByLogin } from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

/** Bench profiles. They are not role grants; both people keep the alpha super user. */
export const LOCAL_TEST_ALIASES = ['responsavel', 'membro'] as const;

export type LocalTestAlias = (typeof LOCAL_TEST_ALIASES)[number];

const BENCH_NAMES: Record<LocalTestAlias, string> = {
  responsavel: 'Bench responsible',
  membro: 'Bench member',
};

export interface LocalTestPersona {
  alias: LocalTestAlias;
  email: string;
  name: string;
  sub: string;
  personMdmId: string;
}

export interface LocalTestSeedResult {
  organizationKey: string;
  companyMdmId: string;
  personas: LocalTestPersona[];
}

export function localTestEmail(projectId: string, alias: LocalTestAlias): string {
  return `${alias}.${projectId}@runtime.test`;
}

export function localTestSub(projectId: string, alias: LocalTestAlias): string {
  return `local-test:${projectId}:${alias}`;
}

function projectIdFrom(config: ProjectsConfig): string {
  const projectId = config.defaultProjectId;
  if (typeof projectId !== 'string' || !/^\d+$/.test(projectId)) {
    throw new AppError('VALIDATION_ERROR', 'defaultProjectId is not a client project id', 400, { field: 'defaultProjectId' });
  }
  return projectId;
}

function onboardingFrom(config: ProjectsConfig): ProjectOnboardingConfig {
  const onboarding = readOnboardingConfig(config);
  if (!onboarding) {
    throw new AppError('VALIDATION_ERROR', 'onboarding config is required', 400, { field: 'onboarding' });
  }
  return onboarding;
}

/**
 * Company plus two bench people. Repeated calls keep the same ids and do not
 * overwrite a name, country, link or version the tester already stored.
 * A pending match or a link to another company is an error; nothing is released.
 */
export async function ensureLocalTestPair(
  ctx: RequestContext,
  config: ProjectsConfig,
  binding: OrganizationBinding,
): Promise<LocalTestSeedResult> {
  const projectId = projectIdFrom(config);
  const onboarding = onboardingFrom(config);
  const company = await ensureOrganizationCompany(ctx, binding, onboarding);
  const personas: LocalTestPersona[] = [];

  for (const alias of LOCAL_TEST_ALIASES) {
    const email = localTestEmail(projectId, alias);
    const existing = await personByLogin(ctx, email);
    if (existing) {
      const relationships = await ctx.data.mdmRelationship.findMany({ where: { fromId: existing.mdmId } });
      const foreign = relationships.some((relationship) =>
        relationship.type === 'AssignedTo'
        && relationship.status === 'Active'
        && relationship.toId !== company.companyMdmId,
      );
      if (foreign) {
        throw new AppError(
          'LOCAL_TEST_LINK_INVALID',
          `local test login ${email} is linked to another company`,
          409,
          { personMdmId: existing.mdmId },
        );
      }
    }

    const registered = await ensureSelfRegistration(ctx, binding, onboarding, {
      email,
      name: BENCH_NAMES[alias],
    });
    if (registered.status === 'pending' || !registered.person) {
      throw new AppError(
        'LOCAL_TEST_AMBIGUOUS',
        `local test login ${email} is ambiguous and was not released`,
        409,
        { email },
      );
    }
    if (registered.company.mdmId !== company.companyMdmId) {
      throw new AppError(
        'LOCAL_TEST_LINK_INVALID',
        `local test login ${email} resolved to another company`,
        409,
        { companyMdmId: registered.company.mdmId },
      );
    }

    const person = await ctx.mdm.entity.get({ mdmId: registered.person.mdmId });
    const sub = localTestSub(projectId, alias);
    if (sub === person.mdmId) {
      throw new AppError('LOCAL_TEST_LINK_INVALID', 'local test sub collided with a person id', 409, { sub });
    }
    personas.push({
      alias,
      email,
      name: person.details.name,
      sub,
      personMdmId: person.mdmId,
    });
  }

  return {
    organizationKey: binding.key,
    companyMdmId: company.companyMdmId,
    personas,
  };
}
