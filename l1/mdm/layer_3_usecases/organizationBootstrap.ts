/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmDetailRecord } from '/_102034_/l1/mdm/module.js';
import { createRegistrationEntity, getEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import {
  REGISTRATION_STORE_PREFIX,
  readRegistrationStore,
  withRegistrationTransaction,
  writeRegistrationStore,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';

export interface OrganizationCompany {
  companyMdmId: string;
}

/** One-shot fault for the memory resume tests. Production leaves this null. */
export type OrganizationBootstrapFault = 'after-reserve' | 'before-return';

let bootstrapFault: OrganizationBootstrapFault | null = null;

/** Company id resolved for this process. The KV/MDM reservation remains the source of truth. */
let resolvedCompanyMdmId: string | undefined;

export function setOrganizationBootstrapFault(next: OrganizationBootstrapFault | null): void {
  bootstrapFault = next;
}

/** Synchronous. Does not read config, the database, or process.env. */
export function getResolvedOrganizationCompanyId(): string | undefined {
  return resolvedCompanyMdmId;
}

export function resetResolvedOrganizationCompanyId(): void {
  resolvedCompanyMdmId = undefined;
}

function throwIfFault(phase: OrganizationBootstrapFault): void {
  if (bootstrapFault !== phase) return;
  throw new Error(`organization bootstrap fault: ${phase}`);
}

export function organizationReservationKey(organizationKey: string): string {
  const digest = createHash('sha256').update(organizationKey).digest('hex');
  return `${REGISTRATION_STORE_PREFIX}org/${digest}`;
}

function invalidReservation(organizationKey: string, reason: string): AppError {
  return new AppError('ORGANIZATION_RESERVATION_INVALID', reason, 500, { organizationKey });
}

function isReservation(value: Record<string, unknown>, organizationKey: string): string {
  if (value.schema !== 1 || value.kind !== 'organization' || value.organizationKey !== organizationKey) {
    throw invalidReservation(organizationKey, 'organization reservation does not match the binding');
  }
  if (typeof value.companyMdmId !== 'string' || value.companyMdmId.length === 0) {
    throw invalidReservation(organizationKey, 'organization reservation has no company id');
  }
  return value.companyMdmId;
}

async function loadCompany(ctx: RequestContext, organizationKey: string, companyMdmId: string) {
  let loaded: Awaited<ReturnType<typeof getEntity>>;
  try {
    loaded = await getEntity(ctx, companyMdmId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
  if (loaded.details.subtype !== 'Company' || loaded.index.subtype !== 'Company') {
    throw invalidReservation(organizationKey, 'organization reservation does not point at a Company');
  }
  return loaded;
}

function hasCompanyType(details: MdmDetailRecord, companyType: string): boolean {
  return Array.isArray(details.tags) && details.tags.includes(companyType);
}

async function attachCompanyType(ctx: RequestContext, companyMdmId: string, companyType: string): Promise<void> {
  const current = await getEntity(ctx, companyMdmId);
  if (current.details.subtype !== 'Company') {
    throw invalidReservation(companyMdmId, 'reserved id is not a Company');
  }
  if (hasCompanyType(current.details, companyType)) return;
  await ctx.mdm.entity.attachRole(companyMdmId, companyType);
}

/**
 * One Company per organization key. The reservation is written before the MDM row so a memory
 * process can resume after a later step fails. Postgres holds the same steps in one locked transaction.
 * A repeat reads that id and does not overwrite a Company that already has data.
 */
export async function ensureOrganizationCompany(
  ctx: RequestContext,
  binding: OrganizationBinding,
  config: ProjectOnboardingConfig,
): Promise<OrganizationCompany> {
  if (!binding?.key || !binding.name) {
    throw new AppError('VALIDATION_ERROR', 'organization binding is required', 400, { field: 'binding' });
  }
  if (!config?.companyType) {
    throw new AppError('VALIDATION_ERROR', 'onboarding.companyType is required', 400, { field: 'companyType' });
  }
  const reservationKey = organizationReservationKey(binding.key);
  return withRegistrationTransaction(ctx, [binding.key], async (tx) => {
    const stored = await readRegistrationStore(tx, reservationKey);
    let companyMdmId: string;
    if (!stored) {
      companyMdmId = tx.idGenerator.newId();
      await writeRegistrationStore(tx, reservationKey, {
        schema: 1,
        kind: 'organization',
        organizationKey: binding.key,
        companyMdmId,
      });
      throwIfFault('after-reserve');
    } else {
      companyMdmId = isReservation(stored, binding.key);
    }

    const existing = await loadCompany(tx, binding.key, companyMdmId);
    if (!existing) {
      const created = await createRegistrationEntity(tx, {
        mdmId: companyMdmId,
        detail: {
          subtype: 'Company',
          name: binding.name,
        },
      });
      if (created.alreadyExists && created.mdmId !== companyMdmId) {
        throw invalidReservation(binding.key, 'organization reservation collided with another Company');
      }
    }

    await attachCompanyType(tx, companyMdmId, config.companyType);
    throwIfFault('before-return');
    return { companyMdmId };
  });
}

/**
 * Boot/migrate entry. Disabled onboarding returns without a context or a Company.
 * The id is published only after ensureOrganizationCompany returns.
 */
export async function initializeOrganizationForProcess(): Promise<void> {
  const { readProjectsConfig } = await import('/_102034_/l1/server/layer_1_external/config/projectConfig.js');
  const { readOnboardingConfig, resolveOrganizationBinding } = await import('/_102034_/l1/server/layer_1_external/config/onboardingConfig.js');
  const projects = readProjectsConfig();
  const onboarding = readOnboardingConfig(projects);
  if (!onboarding) return;
  const binding = resolveOrganizationBinding(projects);
  if (!binding) return;
  const { createDefaultRequestContext } = await import('/_102034_/l1/server/layer_2_controllers/execBff.js');
  const ensured = await ensureOrganizationCompany(createDefaultRequestContext(), binding, onboarding);
  resolvedCompanyMdmId = ensured.companyMdmId;
}
