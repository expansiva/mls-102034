/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationRequests.ts" enhancement="_blank" />
import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import type { OrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { MdmKvRecord } from '/_102034_/l1/mdm/module.js';
import { findRegistrationCandidates, normalizeRegistrationEmail } from '/_102034_/l1/mdm/layer_3_usecases/registrationCandidates.js';
import { isPersonAccessComplete } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import type {
  AccessRequestDecision,
  AccessRequestRecord,
  RegistrationActor,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationContracts.js';
import {
  REGISTRATION_STORE_PREFIX,
  readRegistrationStore,
  withRegistrationTransaction,
  writeRegistrationStore,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import {
  attachPersonMembership,
  checkSelfRegistrationFault,
  ensureDraftPerson,
  isAccessRequest,
  isRequestIndex,
  openOrRecoverAccessRequest,
  personByLogin,
  requestIndexKey,
  requestRecordKey,
  requireCompany,
  reserveLoginPerson,
} from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';

const RECORD_PREFIX = `${REGISTRATION_STORE_PREFIX}access-request/`;
const INDEX_PREFIX = `${REGISTRATION_STORE_PREFIX}access-request/index/`;

/** What the requester is allowed to see: status and id of their own request. */
export interface OwnAccessRequestProjection {
  requestId: string;
  status: AccessRequestRecord['status'];
  version: number;
}

/** Organization follow-up. Candidate tokens only; mdmId is not a resolution parameter. */
export interface OrganizationAccessRequestProjection {
  requestId: string;
  organizationKey: string;
  email: string;
  name: string;
  status: AccessRequestRecord['status'];
  version: number;
  candidateIds: string[];
  decision?: AccessRequestDecision;
  resolvedMdmId?: string;
}

export interface ResolveAccessRequestInput {
  requestId: string;
  expectedVersion: number;
  decision: AccessRequestDecision;
  candidateId?: string;
}

export interface AccessRequestDecisionResult {
  requestId: string;
  status: 'resolved';
  version: number;
  decision: AccessRequestDecision;
  person: { mdmId: string };
  company: { mdmId: string };
  registrationStatus: 'ready' | 'incomplete';
}

function actorName(actor: RegistrationActor): string {
  return typeof actor?.name === 'string' ? actor.name.trim() : '';
}

function actorEmail(actor: RegistrationActor): string {
  const email = normalizeRegistrationEmail(actor?.email ?? '');
  if (!email) {
    throw new AppError('VALIDATION_ERROR', 'login e-mail is required', 400, { field: 'email' });
  }
  return email;
}

/** Audit actor stays an opaque id. requestMeta.userId is telemetry and may be an e-mail. */
function decisionContext(ctx: RequestContext): RequestContext {
  const userId = ctx.requestMeta?.userId;
  if (typeof userId === 'string' && userId.length > 0 && !userId.includes('@')) return ctx;
  return {
    ...ctx,
    requestMeta: { ...ctx.requestMeta, userId: 'registration-resolver' },
  };
}

async function readById(ctx: RequestContext, requestId: string): Promise<AccessRequestRecord | null> {
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'requestId is required', 400, { field: 'requestId' });
  }
  const stored = await readRegistrationStore(ctx, requestRecordKey(requestId));
  if (!stored) return null;
  const organizationKey = stored.organizationKey;
  const email = stored.email;
  if (typeof organizationKey !== 'string' || typeof email !== 'string') {
    throw new AppError('ACCESS_REQUEST_INVALID', 'access request record is invalid', 500, { requestId });
  }
  return isAccessRequest(stored, requestId, organizationKey, email);
}

async function readByOrganizationEmail(
  ctx: RequestContext,
  organizationKey: string,
  email: string,
): Promise<AccessRequestRecord | null> {
  const indexed = await readRegistrationStore(ctx, requestIndexKey(organizationKey, email));
  if (!indexed) return null;
  const requestId = isRequestIndex(indexed, organizationKey, email);
  const stored = await readRegistrationStore(ctx, requestRecordKey(requestId));
  if (!stored) {
    throw new AppError('ACCESS_REQUEST_INVALID', 'access request index points at a missing record', 500, { requestId });
  }
  return isAccessRequest(stored, requestId, organizationKey, email);
}

function ownProjection(record: AccessRequestRecord): OwnAccessRequestProjection {
  return { requestId: record.requestId, status: record.status, version: record.version };
}

function organizationProjection(record: AccessRequestRecord): OrganizationAccessRequestProjection {
  const projection: OrganizationAccessRequestProjection = {
    requestId: record.requestId,
    organizationKey: record.organizationKey,
    email: record.email,
    name: record.name,
    status: record.status,
    version: record.version,
    candidateIds: record.candidates.map((candidate) => candidate.candidateId),
  };
  if (record.decision) projection.decision = record.decision;
  if (record.resolvedMdmId) projection.resolvedMdmId = record.resolvedMdmId;
  return projection;
}

function conflict(record: AccessRequestRecord): AppError {
  return new AppError('ACCESS_REQUEST_CONFLICT', 'access request decision conflicts with the stored state', 409, {
    requestId: record.requestId,
    status: record.status,
    version: record.version,
    decision: record.decision ?? null,
  });
}

function sameResolvedDecision(record: AccessRequestRecord, input: ResolveAccessRequestInput): boolean {
  if (record.status !== 'resolved' || record.decision !== input.decision) return false;
  if (input.decision === 'create-new') return input.candidateId === undefined;
  const chosen = record.candidates.find((candidate) => candidate.mdmId === record.resolvedMdmId);
  return typeof input.candidateId === 'string' && chosen?.candidateId === input.candidateId;
}

/**
 * Open or resend the organization request. A resend cannot rewrite email, name, id or tokens.
 * Candidates come from the registration query, not from the caller.
 */
export async function openAccessRequest(
  ctx: RequestContext,
  binding: OrganizationBinding,
  actor: RegistrationActor,
): Promise<OwnAccessRequestProjection> {
  const email = actorEmail(actor);
  const name = actorName(actor);
  if (!binding?.key) {
    throw new AppError('VALIDATION_ERROR', 'organization binding is required', 400, { field: 'binding' });
  }
  const record = await withRegistrationTransaction(ctx, ['login', email], async (tx) => {
    const existing = await readByOrganizationEmail(tx, binding.key, email);
    if (existing) {
      if (existing.name !== name || existing.email !== email || existing.organizationKey !== binding.key) {
        throw new AppError('ACCESS_REQUEST_IMMUTABLE', 'access request origin cannot be rewritten', 409, {
          requestId: existing.requestId,
        });
      }
      return existing;
    }
    const candidates = await findRegistrationCandidates(tx, email);
    if (candidates.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'access request requires a candidate', 400, { field: 'email' });
    }
    return openOrRecoverAccessRequest(tx, {
      organizationKey: binding.key,
      email,
      name,
      candidateMdmIds: candidates.map((candidate) => candidate.mdmId),
    });
  });
  return ownProjection(record);
}

/** Own request only. A different e-mail or organization does not receive the record. */
export async function readOwnAccessRequest(
  ctx: RequestContext,
  input: { requestId: string; organizationKey: string; email: string },
): Promise<OwnAccessRequestProjection> {
  const email = normalizeRegistrationEmail(input.email ?? '');
  const record = await readById(ctx, input.requestId);
  if (!record || record.organizationKey !== input.organizationKey || record.email !== email) {
    throw new AppError('NOT_FOUND', 'access request not found', 404, { requestId: input.requestId });
  }
  return ownProjection(record);
}

/** Follow-up list for one organization. Requests of other organizations are omitted. */
export async function listOrganizationAccessRequests(
  ctx: RequestContext,
  organizationKey: string,
): Promise<OrganizationAccessRequestProjection[]> {
  if (typeof organizationKey !== 'string' || organizationKey.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'organizationKey is required', 400, { field: 'organizationKey' });
  }
  const repository = await ctx.data.moduleData.getTable<MdmKvRecord>('mdmKv');
  const rows = await repository.findMany({});
  const records: AccessRequestRecord[] = [];
  for (const row of rows) {
    if (!row.key.startsWith(RECORD_PREFIX) || row.key.startsWith(INDEX_PREFIX)) continue;
    const requestId = row.key.slice(RECORD_PREFIX.length);
    if (!requestId || requestId.includes('/')) continue;
    const stored = await readRegistrationStore(ctx, row.key);
    if (!stored) continue;
    const record = await readById(ctx, requestId);
    if (!record || record.organizationKey !== organizationKey) continue;
    records.push(record);
  }
  records.sort((left, right) => left.requestId.localeCompare(right.requestId));
  return records.map(organizationProjection);
}

async function personStillHasEmail(ctx: RequestContext, email: string, mdmId: string): Promise<boolean> {
  const candidates = await findRegistrationCandidates(ctx, email);
  return candidates.some((candidate) => candidate.mdmId === mdmId);
}

async function refuseTakenLogin(ctx: RequestContext, email: string, personMdmId: string): Promise<void> {
  const logged = await personByLogin(ctx, email);
  if (logged && logged.mdmId !== personMdmId) {
    throw new AppError('MDM_LOGIN_TAKEN', 'Login e-mail already belongs to another person', 409, {
      mdmId: logged.mdmId,
    });
  }
}

async function linkPerson(
  ctx: RequestContext,
  binding: OrganizationBinding,
  config: ProjectOnboardingConfig,
  email: string,
  personMdmId: string,
  name: string,
  createDraft: boolean,
): Promise<{ companyMdmId: string; registrationStatus: 'ready' | 'incomplete' }> {
  const companyMdmId = await requireCompany(ctx, binding);
  await refuseTakenLogin(ctx, email, personMdmId);
  const actorCtx = decisionContext(ctx);
  if (createDraft) {
    await reserveLoginPerson(actorCtx, email, personMdmId);
    await ensureDraftPerson(actorCtx, personMdmId, name);
  }
  await actorCtx.mdm.identity.setLogin(personMdmId, email);
  checkSelfRegistrationFault('after-set-login');
  await attachPersonMembership(actorCtx, {
    personMdmId,
    companyMdmId,
    moduleId: config.moduleId,
    personType: config.personType,
  });
  const linked = await personByLogin(actorCtx, email);
  if (!linked || linked.mdmId !== personMdmId) {
    throw new AppError('LOGIN_TARGET_INVALID', 'login does not point at the decided person', 500, { personMdmId });
  }
  return {
    companyMdmId,
    registrationStatus: isPersonAccessComplete(linked) ? 'ready' : 'incomplete',
  };
}

function resultOf(
  record: AccessRequestRecord,
  companyMdmId: string,
  registrationStatus: 'ready' | 'incomplete',
): AccessRequestDecisionResult {
  return {
    requestId: record.requestId,
    status: 'resolved',
    version: record.version,
    decision: record.decision ?? 'use-existing',
    person: { mdmId: record.resolvedMdmId ?? '' },
    company: { mdmId: companyMdmId },
    registrationStatus,
  };
}

/**
 * Resolve under the global e-mail lock. The keyed wrapper is not called again inside it.
 * create-new uses the reserved person id and the stored e-mail and name.
 */
export async function resolveAccessRequest(
  ctx: RequestContext,
  binding: OrganizationBinding,
  config: ProjectOnboardingConfig,
  actor: RegistrationActor,
  input: ResolveAccessRequestInput,
): Promise<AccessRequestDecisionResult> {
  if (input.decision !== 'use-existing' && input.decision !== 'create-new') {
    throw new AppError('VALIDATION_ERROR', 'decision is invalid', 400, { field: 'decision' });
  }
  if (typeof input.expectedVersion !== 'number') {
    throw new AppError('VALIDATION_ERROR', 'expectedVersion is required', 400, { field: 'expectedVersion' });
  }
  const located = await readById(ctx, input.requestId);
  if (!located || !binding?.key || located.organizationKey !== binding.key) {
    throw new AppError('NOT_FOUND', 'access request not found', 404, { requestId: input.requestId });
  }
  actorEmail(actor);
  const decided = await withRegistrationTransaction(ctx, ['login', located.email], async (tx) => {
    const current = await readById(tx, input.requestId);
    if (!current || current.organizationKey !== binding.key) {
      throw new AppError('NOT_FOUND', 'access request not found', 404, { requestId: input.requestId });
    }
    if (current.email !== located.email) {
      throw new AppError('ACCESS_REQUEST_IMMUTABLE', 'access request origin cannot be rewritten', 409, {
        requestId: current.requestId,
      });
    }
    if (sameResolvedDecision(current, input)) {
      const companyMdmId = await requireCompany(tx, binding);
      const linked = await personByLogin(tx, current.email);
      if (!linked || linked.mdmId !== current.resolvedMdmId) {
        throw conflict(current);
      }
      return resultOf(
        current,
        companyMdmId,
        isPersonAccessComplete(linked) ? 'ready' : 'incomplete',
      );
    }
    if (current.status === 'resolved' || current.version !== input.expectedVersion) {
      throw conflict(current);
    }
    if (input.decision === 'create-new') {
      if (input.candidateId !== undefined) {
        throw new AppError('VALIDATION_ERROR', 'create-new does not accept a candidate', 400, { field: 'candidateId' });
      }
      if (!current.reservedPersonId) {
        throw new AppError('ACCESS_REQUEST_INVALID', 'access request has no reserved person', 500, {
          requestId: current.requestId,
        });
      }
      const linked = await linkPerson(
        tx,
        binding,
        config,
        current.email,
        current.reservedPersonId,
        current.name,
        true,
      );
      const resolved = await markResolved(tx, current, 'create-new', current.reservedPersonId);
      return resultOf(resolved, linked.companyMdmId, linked.registrationStatus);
    }
    if (typeof input.candidateId !== 'string' || input.candidateId.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'candidateId is required', 400, { field: 'candidateId' });
    }
    const candidate = current.candidates.find((item) => item.candidateId === input.candidateId);
    if (!candidate) {
      throw new AppError('ACCESS_REQUEST_CANDIDATE_INVALID', 'candidate token is not reserved on the request', 409, {
        requestId: current.requestId,
      });
    }
    const still = await personStillHasEmail(tx, current.email, candidate.mdmId);
    if (!still) {
      throw new AppError('ACCESS_REQUEST_CANDIDATE_INVALID', 'candidate no longer has this contact', 409, {
        requestId: current.requestId,
      });
    }
    const linked = await linkPerson(tx, binding, config, current.email, candidate.mdmId, current.name, false);
    const resolved = await markResolved(tx, current, 'use-existing', candidate.mdmId);
    return resultOf(resolved, linked.companyMdmId, linked.registrationStatus);
  });
  await ctx.cache.del(identityCacheKey(located.email));
  return decided;
}

async function markResolved(
  ctx: RequestContext,
  record: AccessRequestRecord,
  decision: AccessRequestDecision,
  personMdmId: string,
): Promise<AccessRequestRecord> {
  const resolved: AccessRequestRecord = {
    ...record,
    status: 'resolved',
    version: record.version + 1,
    updatedAt: ctx.clock.nowIso(),
    decision,
    resolvedMdmId: personMdmId,
  };
  await writeRegistrationStore(ctx, requestRecordKey(record.requestId), { ...resolved });
  return resolved;
}
