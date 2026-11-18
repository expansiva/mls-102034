/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/agentMember.ts" enhancement="_blank" />
import { requestActorType } from '/_102034_/l1/mdm/layer_3_usecases/core/requestActor.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MDM_ORGANIZATION_MODULE_ID, type MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import { AuditLogService, runMonitoredWrite } from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import { putMdmKv, reserveMdmKv } from '/_102034_/l1/mdm/layer_3_usecases/kvUsecases.js';

/**
 * The virtual employee as a member of the organization: an mdm person with no login, linked to the agent by one row of
 * `mdmTag` (the same table as the link of a login, another namespace). Never deleted; the same agent is always the same member.
 */
export const MDM_AGENT_NAMESPACE = 'agent';
const ENTITY_TYPE = 'MdmEntity';
const KEY_PREFIX = 'agentMember:';
/** A creation that did not finish within this time is taken over by the next call. */
const CREATING_STALE_MS = 30_000;
const WAIT_STEP_MS = 40;
const WAIT_STEPS = 50;

export interface AgentMember {
  mdmId: string;
  name: string;
  active: boolean;
}

export interface EnsureAgentMemberInput {
  agentId: string;
  name: string;
  active: boolean;
}

function assertText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_ERROR', `${field} is required`, 400, { field });
  }
  return value.trim();
}

async function linkRowsOf(ctx: RequestContext, agentId: string): Promise<MdmTagRecord[]> {
  return ctx.data.mdmTag.findMany({
    where: { entityType: ENTITY_TYPE, tag: agentId, module: MDM_ORGANIZATION_MODULE_ID, namespace: MDM_AGENT_NAMESPACE },
  });
}

async function memberOf(ctx: RequestContext, mdmId: string): Promise<AgentMember | null> {
  const index = await ctx.data.mdmEntityIndex.findOne({ where: { mdmId } });
  return index ? { mdmId, name: index.name, active: index.status === 'Active' } : null;
}

export async function findAgentMember(ctx: RequestContext, agentId: string): Promise<AgentMember | null> {
  const row = (await linkRowsOf(ctx, assertText(agentId, 'agentId')))[0];
  return row ? memberOf(ctx, row.entityId) : null;
}

async function writeLink(ctx: RequestContext, mdmId: string, agentId: string): Promise<void> {
  const actorId = ctx.requestMeta?.userId ?? 'system';
  const actorType = requestActorType(ctx);
  await runMonitoredWrite(ctx, {
    entityType: ENTITY_TYPE,
    entityId: mdmId,
    module: MDM_ORGANIZATION_MODULE_ID,
    routine: 'mdm.agentMember.ensure',
    action: 'create',
    actorId,
    actorType,
  }, async () => {
    const record: MdmTagRecord = {
      id: ctx.idGenerator.newId(),
      entityType: ENTITY_TYPE,
      entityId: mdmId,
      tag: agentId,
      namespace: MDM_AGENT_NAMESPACE,
      module: MDM_ORGANIZATION_MODULE_ID,
      createdBy: actorId,
      createdByType: actorType,
      createdAt: ctx.clock.nowIso(),
    };
    await ctx.data.runInTransaction(async (runtime) => {
      await runtime.mdmTag.insert({ record });
      await AuditLogService.record(ctx, runtime, {
        entityType: 'MdmTag',
        entityId: record.id,
        action: 'create',
        module: MDM_ORGANIZATION_MODULE_ID,
        routine: 'mdm.agentMember.ensure',
        before: null,
        after: record as unknown as Record<string, unknown>,
        actor: { actorId, actorType },
      });
    });
  });
}

/** Name and status only when they changed; the entity is the one the link points to. */
async function settle(ctx: RequestContext, mdmId: string, input: { name: string; active: boolean }): Promise<AgentMember> {
  const current = await ctx.mdm.entity.get({ mdmId });
  if (current.index.name !== input.name) {
    await ctx.mdm.entity.update({ mdmId, expectedVersion: current.version, patch: { name: input.name } });
  }
  const wasActive = current.index.status === 'Active';
  if (wasActive !== input.active) {
    const latest = await ctx.mdm.entity.get({ mdmId });
    if (input.active) await ctx.mdm.entity.reactivate({ mdmId, expectedVersion: latest.version });
    else await ctx.mdm.entity.inactivate({ mdmId, expectedVersion: latest.version });
  }
  return (await memberOf(ctx, mdmId)) as AgentMember;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Makes the agent a member: creates it, or sets its name and whether it is active. Two calls at once for one agent
 * create one member (the reservation of the key decides, the insert itself); a creation that stopped midway is finished
 * by the next call with the member it had already created.
 */
export async function ensureAgentMember(ctx: RequestContext, input: EnsureAgentMemberInput): Promise<AgentMember> {
  const agentId = assertText(input.agentId, 'agentId');
  const name = assertText(input.name, 'name');
  const active = input.active === true;

  const existing = await findAgentMember(ctx, agentId);
  if (existing) return settle(ctx, existing.mdmId, { name, active });

  const key = `${KEY_PREFIX}${agentId}`;
  const startedAt = ctx.clock.nowIso();
  for (let attempt = 0; attempt <= WAIT_STEPS; attempt += 1) {
    const taken = await reserveMdmKv(ctx, { key, value: { state: 'creating', at: startedAt } });
    if (taken.reserved) return createMember(ctx, key, agentId, { name, active });

    const linked = await findAgentMember(ctx, agentId);
    if (linked) return settle(ctx, linked.mdmId, { name, active });

    const kept = isRecord(taken.record?.value) ? taken.record.value : {};
    if (typeof kept.mdmId === 'string') {
      // The creator stopped between the entity and the link: the entity is the member, only the link is missing.
      try {
        await writeLink(ctx, kept.mdmId, agentId);
      } catch (error) {
        if (!(await findAgentMember(ctx, agentId))) throw error;
      }
      return settle(ctx, kept.mdmId, { name, active });
    }
    const age = Date.now() - Date.parse(typeof kept.at === 'string' ? kept.at : startedAt);
    if (age > CREATING_STALE_MS) {
      await putMdmKv(ctx, { key, value: { state: 'creating', at: ctx.clock.nowIso() } });
      return createMember(ctx, key, agentId, { name, active });
    }
    await pause(WAIT_STEP_MS);
  }
  throw new AppError('MDM_AGENT_MEMBER_BUSY', 'The member of the agent is being created; try again.', 503, { agentId });
}

async function createMember(ctx: RequestContext, key: string, agentId: string, input: { name: string; active: boolean }): Promise<AgentMember> {
  const created = await ctx.mdm.entity.create({ details: { subtype: 'Person', name: input.name, status: input.active ? 'Active' : 'Inactive' } });
  await putMdmKv(ctx, { key, value: { state: 'created', mdmId: created.mdmId, at: ctx.clock.nowIso() } });
  await writeLink(ctx, created.mdmId, agentId);
  return { mdmId: created.mdmId, name: input.name, active: input.active };
}
