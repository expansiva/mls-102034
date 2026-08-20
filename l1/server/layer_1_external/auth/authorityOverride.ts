/// <mls fileReference="_102034_/l1/server/layer_1_external/auth/authorityOverride.ts" enhancement="_blank" />
// "Presentation mode": acting as another authority to SEE what that role sees, without a second account.
//
// Rules that make it safe, and none of them is optional:
// - only in `development`/`presentation` — in `production`/`homologation` the route is refused, and the
//   authority a user really has is the only one that counts;
// - decided SERVER-side, per authenticated user (`claims.sub`), never a client-side flag anyone can set;
// - the audit always records the REAL identity plus the authorities in force, so a demo can never be
//   mistaken for what the real user did.
//
// Persisted through the platform's own key/value store: a demo has to survive a page reload, and pm2 runs
// in cluster mode, so an in-process map would answer differently on every other request.

import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getMdmKv, putMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';
import { isTestMode, type ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';

const KEY_PREFIX = 'authorityOverride:';

export interface AuthorityOverride {
  /** The real user this override belongs to (`claims.sub`). */
  userId: string;
  /** The authorities to act with, `<moduleId>:<actorId>`. Empty clears the override. */
  authorities: string[];
  setAt: string;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** The refusal reason, or '' when the mode allows overriding. */
export function refuseOverride(mode: ProjectMode): string {
  return isTestMode(mode)
    ? ''
    : `appEnv='${mode}' does not allow acting as another authority: it exists for development and presentation only.`;
}

export async function readAuthorityOverride(ctx: RequestContext, userId: string): Promise<AuthorityOverride | null> {
  if (!userId) return null;
  const record = await getMdmKv(ctx, { key: keyFor(userId) });
  const value = record?.value;
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<AuthorityOverride>;
  const authorities = Array.isArray(stored.authorities)
    ? stored.authorities.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  if (!authorities.length) return null;
  return { userId, authorities, setAt: typeof stored.setAt === 'string' ? stored.setAt : '' };
}

/**
 * Set (or clear, with an empty list) the override of ONE user. The mode is checked here as well as at the
 * route: two defences, because this is the one place that can make a user look like someone else.
 */
export async function writeAuthorityOverride(
  ctx: RequestContext,
  mode: ProjectMode,
  userId: string,
  authorities: string[],
): Promise<AuthorityOverride | null> {
  const refusal = refuseOverride(mode);
  if (refusal) throw new AppError('OVERRIDE_NOT_ALLOWED', refusal, 403, { appEnv: mode });
  if (!userId) throw new AppError('UNAUTHENTICATED', 'An authority override needs an authenticated user.', 401);
  const clean = [...new Set(authorities.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))];
  const override: AuthorityOverride = { userId, authorities: clean, setAt: ctx.clock.nowIso() };
  await putMdmKv(ctx, { key: keyFor(userId), value: clean.length ? { ...override } : null });
  ctx.log.info('auth.override.set', { userId, authorities: clean, appEnv: mode });
  return clean.length ? override : null;
}

/**
 * The authorities a request acts with: the override when one is in force, the real claims otherwise.
 *
 * Returns BOTH, always: the audit records the real identity and what was in force, so an action taken in
 * presentation mode is never indistinguishable from the real user's own.
 */
export function effectiveAuthorities(
  real: readonly string[],
  override: AuthorityOverride | null,
): { authorities: string[]; overridden: boolean; real: string[] } {
  return override && override.authorities.length
    ? { authorities: [...override.authorities], overridden: true, real: [...real] }
    : { authorities: [...real], overridden: false, real: [...real] };
}
