/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationContracts.ts" enhancement="_blank" />

/** Session claims resolved on the server. Never taken from a request body. */
export interface RegistrationActor {
  email: string;
  name: string;
}

export type SelfRegistrationStatus = 'ready' | 'incomplete' | 'pending';

/** Company readiness does not affect status. Person completeness is the rt80 predicate. */
export interface SelfRegistrationResult {
  status: SelfRegistrationStatus;
  person?: { mdmId: string };
  requestId?: string;
  company: { mdmId: string };
}

export type AccessRequestStatus = 'pending' | 'resolved';

export type AccessRequestDecision = 'use-existing' | 'create-new';

/**
 * candidateId is a token reserved on the request.
 * It is not an mdmId and is not a free resolution parameter.
 */
export interface AccessRequestCandidate {
  candidateId: string;
  mdmId: string;
}

/**
 * email, candidate mdmId and resolvedMdmId stay inside the stored record.
 * Callers resolve by requestId plus a reserved candidateId, not by those fields.
 */
export interface AccessRequestRecord {
  schema: 1;
  kind: 'access-request';
  requestId: string;
  organizationKey: string;
  email: string;
  name: string;
  status: AccessRequestStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  candidates: AccessRequestCandidate[];
  reservedPersonId?: string;
  resolvedMdmId?: string;
  decision?: AccessRequestDecision;
}

/** Person that owns a matching contact. Finding one never links a login. */
export interface RegistrationCandidateRef {
  mdmId: string;
}
