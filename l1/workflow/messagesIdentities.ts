/// <mls fileReference="_102034_/l1/workflow/messagesIdentities.ts" enhancement="_blank"/>
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  createServerMessagesClient,
  type ServerMessagesClient,
} from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import type { ResponseResolveModulePeople } from '/_102036_/l2/shared/interfaces.js';
import { lookupLoginEmail } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import type { MessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesTask.js';

type IdentityClient = Pick<ServerMessagesClient, 'linkModulePerson' | 'resolveModulePeople'>;

export interface MessagesWorkflowIdentitiesOptions {
  projectId: string;
  /** Test seam. Production builds a server client bound to projectId. */
  client?: IdentityClient;
}

type Person = ResponseResolveModulePeople['people'][number];
type Direction = 'forward' | 'historical';

const PROTOCOL = 'Identity payload is not valid.';
const UNLINKED = 'Identity is not linked.';
const REMOVED = 'Identity was removed.';
const INCOMPLETE = 'Identity link is incomplete.';
const REMOTE = 'Identity could not be resolved.';
const RECOGNIZED_STATUS = new Set([400, 404, 409, 503]);

function protocol(): never {
  throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', PROTOCOL, 502);
}

function unlinked(): never {
  throw new AppError('WORKFLOW_IDENTITY_UNLINKED', UNLINKED, 409);
}

function removed(): never {
  throw new AppError('WORKFLOW_IDENTITY_REMOVED', REMOVED, 409);
}

function incomplete(): never {
  throw new AppError('WORKFLOW_IDENTITY_INCOMPLETE', INCOMPLETE, 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || value !== value.trim() || /[\r\n]/u.test(value)) return undefined;
  return value;
}

function canonicalProjectId(projectId: string): string {
  if (idText(projectId) === undefined) protocol();
  return projectId;
}

async function transport<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) throw error;
    protocol();
  }
}

function assertRemoteSuccess(result: { httpStatus: number; body: { statusCode?: number } }): void {
  const status = result.body?.statusCode;
  if (result.httpStatus === 200 && status === 200) return;
  if (typeof status === 'number' && status === result.httpStatus && RECOGNIZED_STATUS.has(status)) {
    throw new AppError('WORKFLOW_CM_PROTOCOL_ERROR', REMOTE, status);
  }
  protocol();
}

function personOf(value: unknown): Person {
  if (!isRecord(value)) protocol();
  const state = value.state;
  if (state !== 'linked' && state !== 'unlinked' && state !== 'removed') protocol();
  const mdmId = value.mdmId === undefined ? undefined : idText(value.mdmId);
  const cmUserId = value.cmUserId === undefined ? undefined : idText(value.cmUserId);
  if (value.mdmId !== undefined && mdmId === undefined) protocol();
  if (value.cmUserId !== undefined && cmUserId === undefined) protocol();
  if (mdmId === undefined && cmUserId === undefined) protocol();
  return { mdmId, cmUserId, state };
}

function peopleOf(result: { httpStatus: number; body: { statusCode?: number; people?: unknown } }): Person[] {
  assertRemoteSuccess(result);
  if (!Array.isArray(result.body.people)) protocol();
  return result.body.people.map(personOf);
}

function onePerson(people: Person[], expected: { mdmId?: string; cmUserId?: string }): Person {
  if (people.length !== 1) protocol();
  const person = people[0];
  if (expected.mdmId !== undefined && person.mdmId !== expected.mdmId) protocol();
  if (expected.cmUserId !== undefined && person.cmUserId !== expected.cmUserId) protocol();
  return person;
}

function samePair(left: Person, right: Person): boolean {
  return left.mdmId !== undefined
    && left.cmUserId !== undefined
    && left.mdmId === right.mdmId
    && left.cmUserId === right.cmUserId
    && left.state === right.state;
}

export function createMessagesWorkflowIdentities(options: MessagesWorkflowIdentitiesOptions): MessagesWorkflowIdentities {
  const projectId = canonicalProjectId(options.projectId);
  const asUserId = `app:${projectId}`;
  const client = options.client ?? createServerMessagesClient({ projectId });

  function assertContext(ctx: RequestContext): void {
    const seen = ctx.sessionContext.project.projectId;
    if (seen !== undefined && seen !== projectId) {
      throw new AppError('MSG_APP_SCOPE_INVALID', 'Identity operation is outside the configured application.', 400);
    }
  }

  async function resolveOne(input: { mdmIds?: string[]; cmUserIds?: string[] }, expected: { mdmId?: string; cmUserId?: string }): Promise<Person> {
    const result = await transport(() => client.resolveModulePeople(asUserId, input));
    return onePerson(peopleOf(result), expected);
  }

  async function confirmPair(mdmId: string, cmUserId: string, direction: Direction): Promise<void> {
    const result = await transport(() => client.resolveModulePeople(asUserId, {
      mdmIds: [mdmId],
      cmUserIds: [cmUserId],
    }));
    const people = peopleOf(result);
    if (people.length !== 2) incomplete();
    const [byMdm, byCm] = people;
    if (byMdm.mdmId !== mdmId || byCm.cmUserId !== cmUserId || !samePair(byMdm, byCm)) incomplete();
    if (direction === 'historical') {
      if (byMdm.state !== 'linked' && byMdm.state !== 'removed') incomplete();
      return;
    }
    if (byMdm.state === 'removed') removed();
    if (byMdm.state !== 'linked') incomplete();
  }

  async function toCmUserId(ctx: RequestContext, mdmId: string): Promise<string> {
    assertContext(ctx);
    if (idText(mdmId) === undefined) protocol();
    const person = await resolveOne({ mdmIds: [mdmId] }, { mdmId });
    if (person.state === 'removed') {
      if (person.cmUserId === undefined) protocol();
      removed();
    }
    if (person.state === 'linked') {
      if (person.cmUserId === undefined) protocol();
      await confirmPair(mdmId, person.cmUserId, 'forward');
      return person.cmUserId;
    }
    if (person.cmUserId !== undefined) protocol();
    const email = await lookupLoginEmail(ctx, mdmId);
    if (email === null) unlinked();
    const linked = await transport(() => client.linkModulePerson(asUserId, { mdmId, loginEmail: email }));
    assertRemoteSuccess(linked);
    const cmUserId = idText(linked.body.cmUserId);
    if ((linked.body.outcome !== 'linked' && linked.body.outcome !== 'existing') || cmUserId === undefined) protocol();
    const again = await resolveOne({ mdmIds: [mdmId] }, { mdmId });
    if (again.state === 'removed') removed();
    if (again.state !== 'linked' || again.cmUserId !== cmUserId) incomplete();
    await confirmPair(mdmId, cmUserId, 'forward');
    return cmUserId;
  }

  async function toMdmId(ctx: RequestContext, userId: string): Promise<string> {
    assertContext(ctx);
    if (idText(userId) === undefined) protocol();
    const person = await resolveOne({ cmUserIds: [userId] }, { cmUserId: userId });
    if (person.state === 'unlinked') unlinked();
    if (person.mdmId === undefined || person.cmUserId === undefined) protocol();
    await confirmPair(person.mdmId, person.cmUserId, person.state === 'removed' ? 'historical' : 'forward');
    return person.mdmId;
  }

  return { toCmUserId, toMdmId };
}
