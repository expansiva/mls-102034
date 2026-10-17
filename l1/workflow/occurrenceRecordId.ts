/// <mls fileReference="_102034_/l1/workflow/occurrenceRecordId.ts" enhancement="_blank" />
import { createHash } from 'node:crypto';
import { createMdmFacade } from '/_102034_/l1/mdm/layer_3_usecases/mdmFacade.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

type RecordIdTuple = [
  'workflow-record-v1',
  string,
  string,
  string,
  string | null,
  ['request', string] | ['explicit', string],
];

function requiredText(value: string | null | undefined, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AppError('VALIDATION_ERROR', `${field} is required to derive an occurrence record id.`, 400, { field });
  }
  return text;
}

/** Stable opaque record id. Does not log the seed and does not read telemetry userId or actorId. */
export function occurrenceRecordId(ctx: RequestContext, processId: string, seed?: string): string {
  const project = requiredText(ctx.sessionContext.project.projectId, 'projectId');
  const moduleId = requiredText(ctx.moduleId, 'moduleId');
  const process = requiredText(processId, 'processId');
  const personText = typeof ctx.sessionContext.person?.mdmId === 'string'
    ? ctx.sessionContext.person.mdmId.trim()
    : '';
  const person = personText || null;
  const explicit = seed !== undefined;
  let tail: RecordIdTuple[5];
  if (explicit) {
    tail = ['explicit', requiredText(seed, 'seed')];
  } else {
    if (!person) {
      throw new AppError(
        'VALIDATION_ERROR',
        'person.mdmId is required when no explicit seed is provided.',
        400,
        { field: 'person.mdmId' },
      );
    }
    tail = ['request', requiredText(ctx.requestMeta?.requestId, 'requestId')];
  }
  const tuple: RecordIdTuple = ['workflow-record-v1', project, moduleId, process, person, tail];
  const hex = createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex');
  return `wf_${hex}`;
}

/**
 * Per-creation copy. The first newId is the occurrence record; later ids delegate to the parent generator.
 * Only the isolated create call may use this context, because an earlier audit or write would consume that first id.
 */
export function createOccurrenceContext(ctx: RequestContext, recordId: string): RequestContext {
  let served = false;
  const child: RequestContext = {
    ...ctx,
    idGenerator: {
      newId() {
        if (!served) {
          served = true;
          return recordId;
        }
        return ctx.idGenerator.newId();
      },
    },
  };
  child.mdm = createMdmFacade(child);
  return child;
}
