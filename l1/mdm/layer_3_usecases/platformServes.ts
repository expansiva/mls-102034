/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/platformServes.ts" enhancement="_blank" />
import type { PlatformServeRegistry } from '/_102034_/l1/workflow/connectionServe.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { ensureAgentMember } from '/_102034_/l1/mdm/layer_3_usecases/agentMember.js';

/** What the mdm answers for the connections: the operations marked `servedBy: 'platform'` in the catalogs that touch its data. */
export const mdmPlatformServes: PlatformServeRegistry = new Map([
  [
    'cm.ensureAgentMember',
    async (ctx, input) => {
      const body = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
      if (typeof body.agentId !== 'string' || typeof body.name !== 'string' || typeof body.active !== 'boolean') {
        return { ok: false, code: 'invalid', message: 'agentId, name and active are required' };
      }
      try {
        const member = await ensureAgentMember(ctx, { agentId: body.agentId, name: body.name, active: body.active });
        return { ok: true, output: { mdmId: member.mdmId } };
      } catch (error) {
        if (error instanceof AppError && error.code === 'VALIDATION_ERROR') return { ok: false, code: 'invalid', message: error.message };
        throw error;
      }
    },
  ],
]);
