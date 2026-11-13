/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/localTestSeed.ts" enhancement="_blank" />
import type { ProjectOnboardingConfig, ProjectsConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { readOnboardingConfig, type OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { ensureOrganizationCompany, ensureOrganizationIdentity } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import {
  attachPersonMembership,
  ensureSelfRegistration,
  personByLogin,
} from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

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
  /** True when an Active link to another company was inactivated and the person now belongs to this one. */
  relinked: boolean;
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

/**
 * The registration needs only a module id and a person type. Without an onboarding block (102047)
 * the first member role stands in for it, and the company is the organization's own, with no company type.
 * Without both, there is nothing to seed.
 */
function registrationFrom(
  config: ProjectsConfig,
  roles: readonly { moduleId: string; personType: string }[],
): { onboarding: ProjectOnboardingConfig | null; registration: ProjectOnboardingConfig } {
  const onboarding = readOnboardingConfig(config);
  if (onboarding) return { onboarding, registration: onboarding };
  if (roles.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'onboarding config or a member role is required', 400, { field: 'onboarding' });
  }
  // entryPath and companyType are never read by the registration; the bench does not use them.
  return { onboarding: null, registration: { moduleId: roles[0].moduleId, personType: roles[0].personType, entryPath: '/', companyType: '' } };
}

const MEMBER_ROLE = /^([A-Za-z][A-Za-z0-9]*)\.([A-Z][A-Za-z0-9]*)$/;

/** `<moduleId>.<Tipo>` checked against the project config. No writes. */
export function parseMemberRoles(config: ProjectsConfig, memberRoles: readonly string[]): { moduleId: string; personType: string; tag: string }[] {
  const projectId = projectIdFrom(config);
  const known = new Set(
    (config.projects?.[projectId]?.modules ?? []).map((module) => module.moduleId).filter((id) => typeof id === 'string' && id.length > 0),
  );
  return memberRoles.map((role) => {
    const match = MEMBER_ROLE.exec(role);
    if (!match) {
      throw new AppError('VALIDATION_ERROR', `member role '${role}' is not <moduleId>.<Tipo>`, 400, { role });
    }
    const moduleId = match[1];
    const personType = match[2];
    if (!known.has(moduleId)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `module ${moduleId} is not in the project config`,
        400,
        { moduleId, projectId },
      );
    }
    return { moduleId, personType, tag: `${moduleId}.${personType}` };
  });
}

/** Extra roles for one bench persona, `<moduleId>.<Tipo>` each. */
export type LocalTestAliasRoles = Readonly<Partial<Record<string, readonly string[]>>>;

/** Common roles plus the persona's own, parsed and de-duplicated by tag. No writes. */
function parseAliasRoles(
  config: ProjectsConfig,
  aliasRoles: LocalTestAliasRoles,
  common: readonly { moduleId: string; personType: string; tag: string }[],
): Record<LocalTestAlias, { moduleId: string; personType: string; tag: string }[]> {
  for (const alias of Object.keys(aliasRoles)) {
    if (!(LOCAL_TEST_ALIASES as readonly string[]).includes(alias)) {
      throw new AppError('VALIDATION_ERROR', `alias '${alias}' is not a bench persona`, 400, { alias });
    }
  }
  const result = {} as Record<LocalTestAlias, { moduleId: string; personType: string; tag: string }[]>;
  for (const alias of LOCAL_TEST_ALIASES) {
    const own = parseMemberRoles(config, aliasRoles[alias] ?? []);
    result[alias] = [...common, ...own.filter((role) => !common.some((item) => item.tag === role.tag))];
  }
  return result;
}

/**
 * Company plus two bench people. Repeated calls keep the same ids and do not
 * overwrite a name, country, link or version the tester already stored.
 * A pending match is an error; nothing is released. A bench login linked to another company
 * (the organization key changed) is moved: the old link becomes Inactive and `relinked` is true.
 * `memberRoles` attaches existing module roles; an empty list keeps the previous behavior.
 * Without an onboarding block, at least one member role is required and the first one registers the people.
 * `aliasRoles` adds roles to one bench persona only (same `<moduleId>.<Tipo>` form and checks as `memberRoles`);
 * an alias outside LOCAL_TEST_ALIASES or a module outside the project config is refused before any write.
 */
export async function ensureLocalTestPair(
  ctx: RequestContext,
  config: ProjectsConfig,
  binding: OrganizationBinding,
  memberRoles: readonly string[] = [],
  aliasRoles: LocalTestAliasRoles = {},
): Promise<LocalTestSeedResult> {
  const roles = parseMemberRoles(config, memberRoles);
  const rolesByAlias = parseAliasRoles(config, aliasRoles, roles);
  const projectId = projectIdFrom(config);
  const { onboarding, registration } = registrationFrom(config, roles);
  const company = onboarding
    ? await ensureOrganizationCompany(ctx, binding, onboarding)
    : await ensureOrganizationIdentity(ctx, binding);
  const personas: LocalTestPersona[] = [];

  for (const alias of LOCAL_TEST_ALIASES) {
    const email = localTestEmail(projectId, alias);
    // The reserved bench login is the seed's own identity: whoever holds it is the persona, so a link to
    // another company (the organization key changed since the last run) is moved, not refused.
    const existing = await personByLogin(ctx, email);
    const staleLinks = existing
      ? (await ctx.data.mdmRelationship.findMany({ where: { fromId: existing.mdmId } })).filter((relationship) =>
        relationship.type === 'AssignedTo'
        && relationship.status === 'Active'
        && relationship.toId !== company.companyMdmId)
      : [];

    const registered = await ensureSelfRegistration(ctx, binding, registration, {
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

    // Registered first, so an interrupted run still has the new link; a repeat inactivates what is left.
    for (const link of staleLinks) {
      await ctx.mdm.entity.unlink({ relationshipId: link.id });
    }

    const person = await ctx.mdm.entity.get({ mdmId: registered.person.mdmId });
    const sub = localTestSub(projectId, alias);
    if (sub === person.mdmId) {
      throw new AppError('LOCAL_TEST_LINK_INVALID', 'local test sub collided with a person id', 409, { sub });
    }
    const personaRoles = rolesByAlias[alias];
    for (const role of personaRoles) {
      await attachPersonMembership(ctx, {
        personMdmId: person.mdmId,
        companyMdmId: company.companyMdmId,
        moduleId: role.moduleId,
        personType: role.personType,
      });
      const attached = await ctx.mdm.entity.get({ mdmId: person.mdmId });
      if (!attached.details.tags.includes(role.tag)) {
        throw new AppError('LOCAL_TEST_ROLE_MISSING', `member role ${role.tag} was not attached`, 409, {
          personMdmId: person.mdmId,
          role: role.tag,
        });
      }
      if (attached.details.status !== 'Active') {
        throw new AppError(
          'LOCAL_TEST_PERSON_INACTIVE',
          `local test person ${email} is not Active`,
          409,
          { personMdmId: person.mdmId, status: attached.details.status },
        );
      }
    }

    const stored = personaRoles.length > 0 ? await ctx.mdm.entity.get({ mdmId: person.mdmId }) : person;
    personas.push({
      alias,
      email,
      name: stored.details.name,
      sub,
      personMdmId: stored.mdmId,
      relinked: staleLinks.length > 0,
    });
  }

  return {
    organizationKey: binding.key,
    companyMdmId: company.companyMdmId,
    personas,
  };
}
