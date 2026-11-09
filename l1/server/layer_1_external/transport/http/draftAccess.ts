/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftAccess.ts" enhancement="_blank" />
// Who may use a draft through /execBff (rt198): ONE function, so a future "developer authority" has one place to enter.
//
// Today a valid session could send the draft cookie of anybody and the proxy would forward it. Now:
//   user-…  only the person whose e-mail makes that slug (`draftSlugForUser`);
//   team-…  only a session of the organization that owns the project (the sites' project file, `org.orgId`).
// Anything else is a 403, never a 401: a 401 sends the Studio to the login, and the person is logged in. In alpha every
// logged-in member of the organization may use the team draft (no role is asked yet).
//
// No claims = nothing to check: the anonymous call of stage 1 is not decided here.

import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { activeOrganizationId } from '/_102034_/l1/server/layer_1_external/cbe/cbeAuthJwt.js';
import { draftSlugForUser, parseDraftSlug } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { readProjectFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';

export type DraftAccessReason =
  | 'user-draft-not-yours'
  | 'team-draft-other-org'
  | 'team-draft-no-org'
  | 'org-claims-conflict'
  | 'bad-slug';

export type DraftAccess = { allowed: true } | { allowed: false; reason: DraftAccessReason };

export interface DraftAccessDeps {
  /** The organization that owns the project (its project file's org id), or undefined when the machine has no such file. */
  projectOrgId?: (projectId: number) => string | undefined;
}

const defaultProjectOrgId = (projectId: number): string | undefined => readProjectFile(projectId)?.org.orgId;

export function canUseDraft(
  claims: CollabAuthClaims | undefined,
  projectId: number,
  slug: string,
  deps: DraftAccessDeps = {},
): DraftAccess {
  if (!claims) return { allowed: true };
  if (!parseDraftSlug(slug)) return { allowed: false, reason: 'bad-slug' };

  if (slug.startsWith('user-')) {
    const email = typeof claims.email === 'string' ? claims.email.trim() : '';
    return email !== '' && draftSlugForUser(email).slug === slug
      ? { allowed: true }
      : { allowed: false, reason: 'user-draft-not-yours' };
  }

  // team-…: the organization of the project. No project file (lima, dev) = the owner is unknown, nothing to compare.
  const owner = (deps.projectOrgId ?? defaultProjectOrgId)(projectId);
  if (owner === undefined) return { allowed: true };
  let sessionOrg: string | null;
  try {
    sessionOrg = activeOrganizationId(claims);
  } catch {
    return { allowed: false, reason: 'org-claims-conflict' };
  }
  if (sessionOrg === null) return { allowed: false, reason: 'team-draft-no-org' };
  return sessionOrg === owner ? { allowed: true } : { allowed: false, reason: 'team-draft-other-org' };
}
