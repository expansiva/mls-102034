/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/identityUsecases.ts" enhancement="_blank" />
import {
  AppError,
  type CollabAuthInviteClient,
  type PlatformSessionPerson,
  type RequestContext,
} from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  identityCacheKey,
  identityCacheTtlSeconds,
  type IdentityCacheValue,
} from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import { MDM_ORGANIZATION_MODULE_ID, type MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import {
  AuditLogService,
  runMonitoredWrite,
} from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';

export const MDM_LOGIN_NAMESPACE = 'login';
export const MDM_LOGIN_ENTITY_TYPE = 'MdmEntity';

export interface MdmIdentityInviteInput {
  mdmId: string;
  email: string;
  moduleId: string;
  actorId: string;
}

export interface MdmIdentityInviteResult {
  token: string;
  expiresAt: string;
}

function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertLoginEmail(email: string): string {
  const normalized = normalizeLoginEmail(email);
  if (!normalized || !normalized.includes('@') || /\s/u.test(normalized)) {
    throw new AppError('VALIDATION_ERROR', 'login e-mail is required', 400, { field: 'email' });
  }
  if (normalized.length > 254) {
    throw new AppError('VALIDATION_ERROR', 'login e-mail exceeds 254 chars', 400, { field: 'email' });
  }
  return normalized;
}

async function findLoginRowsByEmail(ctx: RequestContext, email: string): Promise<MdmTagRecord[]> {
  return ctx.data.mdmTag.findMany({
    where: {
      entityType: MDM_LOGIN_ENTITY_TYPE,
      tag: email,
      module: MDM_ORGANIZATION_MODULE_ID,
      namespace: MDM_LOGIN_NAMESPACE,
    },
  });
}

async function findLoginRowsByEntity(ctx: RequestContext, mdmId: string): Promise<MdmTagRecord[]> {
  const rows = await ctx.data.mdmTag.findMany({
    where: {
      entityType: MDM_LOGIN_ENTITY_TYPE,
      entityId: mdmId,
    },
  });
  return rows.filter(
    row => row.namespace === MDM_LOGIN_NAMESPACE && row.module === MDM_ORGANIZATION_MODULE_ID,
  );
}

async function readPersonName(ctx: RequestContext, mdmId: string): Promise<string> {
  const index = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId } });
  return index?.name ?? '';
}

async function writeIdentityCache(
  ctx: RequestContext,
  email: string,
  value: IdentityCacheValue | null,
): Promise<void> {
  const key = identityCacheKey(email);
  if (!value) {
    await ctx.cache.del(key);
    return;
  }
  await ctx.cache.set(key, value, identityCacheTtlSeconds());
}

export async function lookupLogin(
  ctx: RequestContext,
  email: string,
): Promise<IdentityCacheValue | null> {
  const normalized = normalizeLoginEmail(email);
  if (!normalized) return null;
  const cached = await ctx.cache.get<IdentityCacheValue>(identityCacheKey(normalized));
  if (cached?.mdmId) return cached;
  const rows = await findLoginRowsByEmail(ctx, normalized);
  const row = rows[0];
  if (!row) return null;
  const value: IdentityCacheValue = {
    mdmId: row.entityId,
    name: await readPersonName(ctx, row.entityId),
  };
  await writeIdentityCache(ctx, normalized, value);
  return value;
}

export async function findByLogin(ctx: RequestContext, email: string): Promise<string | null> {
  const found = await lookupLogin(ctx, email);
  return found?.mdmId ?? null;
}

export async function resolveSessionPerson(
  ctx: RequestContext,
  email: string,
): Promise<PlatformSessionPerson | null> {
  const found = await lookupLogin(ctx, email);
  if (!found) return null;
  return {
    mdmId: found.mdmId,
    email: normalizeLoginEmail(email),
    name: found.name,
  };
}

export async function setLogin(
  ctx: RequestContext,
  mdmId: string,
  email: string,
): Promise<{ mdmId: string; email: string }> {
  const normalized = assertLoginEmail(email);
  if (!mdmId) {
    throw new AppError('VALIDATION_ERROR', 'mdmId is required', 400, { field: 'mdmId' });
  }

  const index = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId } });
  if (!index) {
    throw new AppError('NOT_FOUND', 'Entity not found', 404, { mdmId });
  }

  const taken = await findLoginRowsByEmail(ctx, normalized);
  const takenByOther = taken.find(row => row.entityId !== mdmId);
  if (takenByOther) {
    throw new AppError('MDM_LOGIN_TAKEN', 'Login e-mail already belongs to another person', 409, {
      email: normalized,
      mdmId: takenByOther.entityId,
    });
  }

  const previous = await findLoginRowsByEntity(ctx, mdmId);
  const alreadyThisEmail = previous.find(row => row.tag === normalized);

  return runMonitoredWrite(ctx, {
    entityType: MDM_LOGIN_ENTITY_TYPE,
    entityId: mdmId,
    module: MDM_ORGANIZATION_MODULE_ID,
    routine: 'mdm.identity.setLogin',
    action: alreadyThisEmail ? 'update' : 'create',
    actorId: ctx.requestMeta?.userId ?? 'system',
    actorType: ctx.requestMeta?.userId ? 'user' : 'system',
  }, async () => {
    const actorId = ctx.requestMeta?.userId ?? 'system';
    const actorType = ctx.requestMeta?.userId ? 'user' : 'system';
    const record: MdmTagRecord = alreadyThisEmail ?? {
      id: ctx.idGenerator.newId(),
      entityType: MDM_LOGIN_ENTITY_TYPE,
      entityId: mdmId,
      tag: normalized,
      namespace: MDM_LOGIN_NAMESPACE,
      module: MDM_ORGANIZATION_MODULE_ID,
      createdBy: actorId,
      createdByType: actorType,
      createdAt: ctx.clock.nowIso(),
    };

    await ctx.data.runInTransaction(async runtime => {
      for (const row of previous) {
        if (row.id === record.id) continue;
        await runtime.mdmTag.delete({
          where: {
            entityType: row.entityType,
            entityId: row.entityId,
            tag: row.tag,
            module: row.module,
          },
        });
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmTag',
          entityId: row.id,
          action: 'delete',
          module: MDM_ORGANIZATION_MODULE_ID,
          routine: 'mdm.identity.setLogin',
          before: row as unknown as Record<string, unknown>,
          after: null,
        });
      }

      if (!alreadyThisEmail) {
        await runtime.mdmTag.insert({ record });
        await AuditLogService.record(ctx, runtime, {
          entityType: 'MdmTag',
          entityId: record.id,
          action: 'create',
          module: MDM_ORGANIZATION_MODULE_ID,
          routine: 'mdm.identity.setLogin',
          before: null,
          after: record as unknown as Record<string, unknown>,
          actor: { actorId, actorType },
        });
      }
    });

    for (const row of previous) {
      await writeIdentityCache(ctx, row.tag, null);
    }
    await writeIdentityCache(ctx, normalized, { mdmId, name: index.name });
    return { mdmId, email: normalized };
  });
}

export async function createCollabAuthInviteHttp(input: {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  email: string;
  moduleId: string;
  actorId: string;
}): Promise<MdmIdentityInviteResult> {
  const url = `${input.baseUrl.replace(/\/$/u, '')}/internal/orgs/${encodeURIComponent(input.orgId)}/invites`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      role: 'member',
      module: input.moduleId,
      actor: input.actorId,
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    invite?: { token?: string; expires_at?: string };
    msg?: string;
  };
  if (!response.ok || !body.invite?.token) {
    throw new AppError(
      'COLLAB_AUTH_INVITE_FAILED',
      body.msg ?? `collab-auth invite failed (${response.status})`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }
  const expiresAt = body.invite.expires_at
    ? new Date(body.invite.expires_at).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return { token: body.invite.token, expiresAt };
}

function defaultInviteClient(): CollabAuthInviteClient {
  return {
    async createInvite(input) {
      const baseUrl = process.env.COLLAB_AUTH_BASE_URL ?? 'https://auth.collab.codes';
      const apiKey = process.env.COLLAB_AUTH_API_KEY;
      const orgId = input.orgId || process.env.COLLAB_AUTH_ORG_ID;
      if (!apiKey || !orgId) {
        throw new AppError(
          'COLLAB_AUTH_UNAVAILABLE',
          'COLLAB_AUTH_API_KEY and COLLAB_AUTH_ORG_ID are required to invite',
          503,
        );
      }
      return createCollabAuthInviteHttp({
        baseUrl,
        apiKey,
        orgId,
        email: input.email,
        moduleId: input.moduleId,
        actorId: input.actorId,
      });
    },
  };
}

export async function invite(
  ctx: RequestContext,
  input: MdmIdentityInviteInput,
): Promise<MdmIdentityInviteResult> {
  const normalized = assertLoginEmail(input.email);
  await setLogin(ctx, input.mdmId, normalized);
  const orgId = process.env.COLLAB_AUTH_ORG_ID ?? '';
  const client = ctx.collabAuthInvite ?? defaultInviteClient();
  return client.createInvite({
    orgId,
    email: normalized,
    apiKey: process.env.COLLAB_AUTH_API_KEY ?? '',
    moduleId: input.moduleId,
    actorId: input.actorId,
  });
}
