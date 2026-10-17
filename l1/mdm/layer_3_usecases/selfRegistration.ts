/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/selfRegistration.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';

import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmDetailRecord } from '/_102034_/l1/mdm/module.js';
import { createRegistrationEntity, getEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import { createMdmFacade } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { isPersonAccessComplete } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { findRegistrationCandidates, normalizeRegistrationEmail } from '/_102034_/l1/mdm/layer_3_usecases/registrationCandidates.js';
import type {
  AccessRequestCandidate,
  AccessRequestRecord,
  RegistrationActor,
  SelfRegistrationResult,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationContracts.js';
import {
  REGISTRATION_STORE_PREFIX,
  readRegistrationStore,
  withRegistrationTransaction,
  writeRegistrationStore,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import { organizationReservationKey } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';

/** One-shot fault so memory tests can resume after a completed MDM step. */
export type SelfRegistrationFault = 'after-reserve' | 'after-create' | 'after-set-login' | 'after-link';

let registrationFault: SelfRegistrationFault | null = null;

export function setSelfRegistrationFault(next: SelfRegistrationFault | null): void {
  registrationFault = next;
}

function throwIfFault(phase: SelfRegistrationFault): void {
  if (registrationFault !== phase) return;
  throw new Error(`self registration fault: ${phase}`);
}

function loginReservationKey(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex');
  return `${REGISTRATION_STORE_PREFIX}login/${digest}`;
}

function requestIndexKey(organizationKey: string, email: string): string {
  const digest = createHash('sha256').update(JSON.stringify([organizationKey, email])).digest('hex');
  return `${REGISTRATION_STORE_PREFIX}access-request/index/${digest}`;
}

function requestRecordKey(requestId: string): string {
  return `${REGISTRATION_STORE_PREFIX}access-request/${requestId}`;
}

function invalid(code: string, message: string, details: Record<string, unknown>): AppError {
  return new AppError(code, message, 500, details);
}

function roleTag(moduleId: string, personType: string): string {
  const trimmed = personType.trim();
  if (!moduleId.trim() || !trimmed) {
    throw new AppError('VALIDATION_ERROR', 'onboarding.personType is required', 400, { field: 'personType' });
  }
  return trimmed.includes('.') ? trimmed : `${moduleId}.${trimmed}`;
}

async function requireCompany(ctx: RequestContext, binding: OrganizationBinding): Promise<string> {
  if (!binding?.key) {
    throw new AppError('VALIDATION_ERROR', 'organization binding is required', 400, { field: 'binding' });
  }
  const stored = await readRegistrationStore(ctx, organizationReservationKey(binding.key));
  if (!stored || stored.kind !== 'organization' || stored.organizationKey !== binding.key) {
    throw invalid('ORGANIZATION_NOT_READY', 'organization company is not reserved', { organizationKey: binding.key });
  }
  if (typeof stored.companyMdmId !== 'string' || stored.companyMdmId.length === 0) {
    throw invalid('ORGANIZATION_NOT_READY', 'organization reservation has no company', { organizationKey: binding.key });
  }
  const company = await loadPersonOrCompany(ctx, stored.companyMdmId);
  if (!company || company.subtype !== 'Company') {
    throw invalid('ORGANIZATION_NOT_READY', 'organization reservation does not point at a Company', {
      organizationKey: binding.key,
    });
  }
  return stored.companyMdmId;
}

async function loadPersonOrCompany(ctx: RequestContext, mdmId: string): Promise<MdmDetailRecord | null> {
  try {
    const loaded = await getEntity(ctx, mdmId);
    return loaded.details;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

function isLoginReservation(value: Record<string, unknown>, email: string): string {
  if (value.schema !== 1 || value.kind !== 'login-reservation' || value.email !== email) {
    throw invalid('LOGIN_RESERVATION_INVALID', 'login reservation does not match the e-mail', { email });
  }
  if (typeof value.personMdmId !== 'string' || value.personMdmId.length === 0) {
    throw invalid('LOGIN_RESERVATION_INVALID', 'login reservation has no person id', { email });
  }
  return value.personMdmId;
}

function isRequestIndex(value: Record<string, unknown>, organizationKey: string, email: string): string {
  if (value.kind !== 'access-request-index' || value.organizationKey !== organizationKey || value.email !== email) {
    throw invalid('ACCESS_REQUEST_INVALID', 'access request index does not match the organization e-mail', {
      organizationKey,
    });
  }
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    throw invalid('ACCESS_REQUEST_INVALID', 'access request index has no request id', { organizationKey });
  }
  return value.requestId;
}

function isAccessRequest(value: Record<string, unknown>, requestId: string, organizationKey: string, email: string): AccessRequestRecord {
  const candidates = value.candidates;
  const status = value.status;
  if (
    value.schema !== 1
    || value.kind !== 'access-request'
    || value.requestId !== requestId
    || value.organizationKey !== organizationKey
    || value.email !== email
    || (status !== 'pending' && status !== 'resolved')
    || typeof value.version !== 'number'
    || typeof value.name !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !Array.isArray(candidates)
    || candidates.some((candidate) => !isCandidate(candidate))
  ) {
    throw invalid('ACCESS_REQUEST_INVALID', 'access request record is invalid', { requestId });
  }
  const record: AccessRequestRecord = {
    schema: 1,
    kind: 'access-request',
    requestId,
    organizationKey,
    email,
    name: value.name,
    status,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    candidates: candidates.filter(isCandidate),
  };
  if (typeof value.reservedPersonId === 'string') record.reservedPersonId = value.reservedPersonId;
  if (typeof value.resolvedMdmId === 'string') record.resolvedMdmId = value.resolvedMdmId;
  if (value.decision === 'use-existing' || value.decision === 'create-new') record.decision = value.decision;
  return record;
}

function isCandidate(value: unknown): value is AccessRequestCandidate {
  if (typeof value !== 'object' || value === null) return false;
  if (!('candidateId' in value) || !('mdmId' in value)) return false;
  return typeof value.candidateId === 'string' && typeof value.mdmId === 'string';
}

/** Open or reload the organization e-mail request. Retry keeps the same requestId and tokens. */
export async function openOrRecoverAccessRequest(
  ctx: RequestContext,
  input: { organizationKey: string; email: string; name: string; candidateMdmIds: string[] },
): Promise<AccessRequestRecord> {
  const indexKey = requestIndexKey(input.organizationKey, input.email);
  const indexed = await readRegistrationStore(ctx, indexKey);
  if (indexed) {
    const requestId = isRequestIndex(indexed, input.organizationKey, input.email);
    const stored = await readRegistrationStore(ctx, requestRecordKey(requestId));
    if (!stored) {
      throw invalid('ACCESS_REQUEST_INVALID', 'access request index points at a missing record', { requestId });
    }
    return isAccessRequest(stored, requestId, input.organizationKey, input.email);
  }

  const now = ctx.clock.nowIso();
  const requestId = ctx.idGenerator.newId();
  const candidates: AccessRequestCandidate[] = input.candidateMdmIds.map((mdmId) => ({
    candidateId: ctx.idGenerator.newId(),
    mdmId,
  }));
  const record: AccessRequestRecord = {
    schema: 1,
    kind: 'access-request',
    requestId,
    organizationKey: input.organizationKey,
    email: input.email,
    name: input.name,
    status: 'pending',
    version: 1,
    createdAt: now,
    updatedAt: now,
    candidates,
    reservedPersonId: ctx.idGenerator.newId(),
  };
  await writeRegistrationStore(ctx, requestRecordKey(requestId), { ...record });
  await writeRegistrationStore(ctx, indexKey, {
    kind: 'access-request-index',
    organizationKey: input.organizationKey,
    email: input.email,
    requestId,
  });
  return record;
}

async function reconcileAccessRequest(
  ctx: RequestContext,
  organizationKey: string,
  email: string,
  personMdmId: string,
): Promise<string | undefined> {
  const indexed = await readRegistrationStore(ctx, requestIndexKey(organizationKey, email));
  if (!indexed) return undefined;
  const requestId = isRequestIndex(indexed, organizationKey, email);
  const stored = await readRegistrationStore(ctx, requestRecordKey(requestId));
  if (!stored) {
    throw invalid('ACCESS_REQUEST_INVALID', 'access request index points at a missing record', { requestId });
  }
  const record = isAccessRequest(stored, requestId, organizationKey, email);
  if (record.status === 'resolved') return record.requestId;
  const resolved: AccessRequestRecord = {
    ...record,
    status: 'resolved',
    version: record.version + 1,
    updatedAt: ctx.clock.nowIso(),
    resolvedMdmId: personMdmId,
  };
  await writeRegistrationStore(ctx, requestRecordKey(requestId), { ...resolved });
  return requestId;
}

async function reserveLoginPerson(ctx: RequestContext, email: string): Promise<string> {
  const key = loginReservationKey(email);
  const stored = await readRegistrationStore(ctx, key);
  if (stored) return isLoginReservation(stored, email);
  const personMdmId = ctx.idGenerator.newId();
  await writeRegistrationStore(ctx, key, {
    schema: 1,
    kind: 'login-reservation',
    email,
    personMdmId,
  });
  throwIfFault('after-reserve');
  return personMdmId;
}

async function ensureDraftPerson(ctx: RequestContext, personMdmId: string, name: string): Promise<void> {
  const existing = await loadPersonOrCompany(ctx, personMdmId);
  if (existing) {
    if (existing.subtype !== 'Person') {
      throw invalid('LOGIN_RESERVATION_INVALID', 'login reservation does not point at a Person', { personMdmId });
    }
    return;
  }
  const created = await createRegistrationEntity(ctx, {
    mdmId: personMdmId,
    detail: { subtype: 'Person', name, countryCode: '' },
  });
  if (created.alreadyExists && created.mdmId !== personMdmId) {
    throw invalid('LOGIN_RESERVATION_INVALID', 'login reservation collided with another person', { personMdmId });
  }
  throwIfFault('after-create');
}

function contextForRole(ctx: RequestContext, moduleId: string): RequestContext {
  const next: RequestContext = { ...ctx, moduleId };
  next.mdm = createMdmFacade(next);
  return next;
}

/** Role tag and member link. Skips writes that are already present. Does not write the module namespace. */
export async function attachPersonMembership(
  ctx: RequestContext,
  input: { personMdmId: string; companyMdmId: string; moduleId: string; personType: string },
): Promise<void> {
  const tag = roleTag(input.moduleId, input.personType);
  const current = await ctx.mdm.entity.get({ mdmId: input.personMdmId });
  if (current.details.subtype !== 'Person') {
    throw invalid('LOGIN_RESERVATION_INVALID', 'login does not point at a Person', { personMdmId: input.personMdmId });
  }
  if (!current.details.tags.includes(tag)) {
    await contextForRole(ctx, input.moduleId).mdm.entity.attachRole(input.personMdmId, input.personType);
  }

  const relationships = await ctx.data.mdmRelationship.findMany({ where: { fromId: input.personMdmId } });
  const linked = relationships.some((relationship) =>
    relationship.toId === input.companyMdmId
    && relationship.type === 'AssignedTo'
    && relationship.role === 'member'
    && relationship.status === 'Active',
  );
  if (!linked) {
    await ctx.mdm.entity.link({
      fromId: input.personMdmId,
      toId: input.companyMdmId,
      type: 'AssignedTo',
      role: 'member',
    });
    throwIfFault('after-link');
  }
}

async function personByLogin(ctx: RequestContext, email: string): Promise<MdmDetailRecord | null> {
  const mdmId = await ctx.mdm.identity.findByLogin(email);
  if (!mdmId) return null;
  const detail = await loadPersonOrCompany(ctx, mdmId);
  if (!detail) {
    throw invalid('LOGIN_TARGET_INVALID', 'login points at a missing entity', { mdmId });
  }
  if (detail.subtype !== 'Person') {
    throw invalid('LOGIN_TARGET_INVALID', 'login does not point at a Person', { mdmId });
  }
  return detail;
}

function resultFor(
  detail: MdmDetailRecord,
  companyMdmId: string,
  requestId?: string,
): SelfRegistrationResult {
  return {
    status: isPersonAccessComplete(detail) ? 'ready' : 'incomplete',
    person: { mdmId: detail.mdmId },
    requestId,
    company: { mdmId: companyMdmId },
  };
}

/**
 * Repeated self-registration for a server-resolved actor.
 * The lock is the e-mail in this database. The request is per organization and e-mail.
 * Callers drop the parent identity cache only after this returns.
 */
export async function ensureSelfRegistration(
  ctx: RequestContext,
  binding: OrganizationBinding,
  config: ProjectOnboardingConfig,
  actor: RegistrationActor,
): Promise<SelfRegistrationResult> {
  const email = normalizeRegistrationEmail(actor?.email ?? '');
  if (!email) {
    throw new AppError('VALIDATION_ERROR', 'login e-mail is required', 400, { field: 'email' });
  }
  const name = typeof actor.name === 'string' ? actor.name.trim() : '';
  roleTag(config?.moduleId ?? '', config?.personType ?? '');
  const companyMdmId = await requireCompany(ctx, binding);

  const result = await withRegistrationTransaction(ctx, ['login', email], async (tx) => {
      const logged = await personByLogin(tx, email);
      if (logged) {
        await attachPersonMembership(tx, {
          personMdmId: logged.mdmId,
          companyMdmId,
          moduleId: config.moduleId,
          personType: config.personType,
        });
        const requestId = await reconcileAccessRequest(tx, binding.key, email, logged.mdmId);
        const current = await loadPersonOrCompany(tx, logged.mdmId);
        return resultFor(current ?? logged, companyMdmId, requestId);
      }

      const candidates = await findRegistrationCandidates(tx, email);
      if (candidates.length > 0) {
        const request = await openOrRecoverAccessRequest(tx, {
          organizationKey: binding.key,
          email,
          name,
          candidateMdmIds: candidates.map((candidate) => candidate.mdmId),
        });
        return {
          status: 'pending' as const,
          requestId: request.requestId,
          company: { mdmId: companyMdmId },
        };
      }

      const personMdmId = await reserveLoginPerson(tx, email);
      await ensureDraftPerson(tx, personMdmId, name);
      await tx.mdm.identity.setLogin(personMdmId, email);
      throwIfFault('after-set-login');
      await attachPersonMembership(tx, {
        personMdmId,
        companyMdmId,
        moduleId: config.moduleId,
        personType: config.personType,
      });
      const requestId = await reconcileAccessRequest(tx, binding.key, email, personMdmId);
      const created = await loadPersonOrCompany(tx, personMdmId);
      if (!created || created.subtype !== 'Person') {
        throw invalid('LOGIN_RESERVATION_INVALID', 'reserved person is missing', { personMdmId });
      }
      return resultFor(created, companyMdmId, requestId);
    });
  await ctx.cache.del(identityCacheKey(email));
  return result;
}
