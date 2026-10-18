/// <mls fileReference="_102034_/l1/mdm/registration.ts" enhancement="_blank" />
import { isAlphaAllAuthorities } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import { loadRegistrationScope } from '/_102034_/l1/server/layer_1_external/config/registrationScope.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  listOrganizationAccessRequests,
  readOrganizationAccessRequest,
  type OrganizationAccessRequestProjection,
} from '/_102034_/l1/mdm/layer_3_usecases/registrationRequests.js';

/** Minimal state for a trusted module/process. No e-mail, name or candidate tokens. */
export type AccessRequestState =
  | { requestId: string; status: 'pending'; version: number }
  | { requestId: string; status: 'resolved'; version: number; person: { mdmId: string } };

function requireRegistrationContext(ctx: RequestContext): { organizationKey: string } {
  const scope = loadRegistrationScope();
  if (!isAlphaAllAuthorities(scope.projectId)) {
    throw new AppError('NOT_AVAILABLE', 'onboarding follow-up is not available', 404);
  }
  const projectId = ctx.sessionContext?.project?.projectId;
  if (projectId !== scope.projectId || ctx.moduleId !== scope.config.moduleId) {
    throw new AppError('FORBIDDEN', 'registration context is not the configured client module', 403);
  }
  return { organizationKey: scope.binding.key };
}

function requireSessionPerson(ctx: RequestContext): void {
  const person = ctx.sessionContext?.person;
  const mdmId = typeof person?.mdmId === 'string' ? person.mdmId.trim() : '';
  const email = typeof person?.email === 'string' ? person.email.trim() : '';
  if (!mdmId || !email.includes('@')) {
    throw new AppError('FORBIDDEN', 'session person is required', 403);
  }
}

function minimalState(projection: OrganizationAccessRequestProjection): AccessRequestState {
  if (projection.status === 'pending') {
    return { requestId: projection.requestId, status: 'pending', version: projection.version };
  }
  const mdmId = typeof projection.resolvedMdmId === 'string' ? projection.resolvedMdmId.trim() : '';
  if (projection.status !== 'resolved' || !mdmId) {
    throw new AppError('ACCESS_REQUEST_INVALID', 'resolved access request has no person target', 500, {
      requestId: projection.requestId,
    });
  }
  return {
    requestId: projection.requestId,
    status: 'resolved',
    version: projection.version,
    person: { mdmId },
  };
}

/** Direct reread by id for trusted module/process code. A pending wait may have no Person. */
export async function readAccessRequestState(
  ctx: RequestContext,
  input: { requestId: string },
): Promise<AccessRequestState> {
  const { organizationKey } = requireRegistrationContext(ctx);
  const projection = await readOrganizationAccessRequest(ctx, organizationKey, input.requestId);
  return minimalState(projection);
}

/** Pending follow-up for the configured organization. Requires the runtime session person. */
export async function listPendingAccessRequests(
  ctx: RequestContext,
): Promise<OrganizationAccessRequestProjection[]> {
  const { organizationKey } = requireRegistrationContext(ctx);
  requireSessionPerson(ctx);
  const rows = await listOrganizationAccessRequests(ctx, organizationKey);
  return rows.filter((row) => row.status === 'pending');
}
