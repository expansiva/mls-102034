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
const RECOGNIZED_STATUS = new Set([400, 404, 409, 503, 507]);

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
  if (state !== 'linked' && state !== 'unlinked' && state !== 'removed' && state !== 'inconsistent') protocol();
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

  /** The rules of a confirmed pair, shared by the one-person and the grouped paths. */
  function checkPair(byMdm: Person, byCm: Person, mdmId: string, cmUserId: string, direction: Direction): void {
    // The producer reports a record whose two sides disagree as `inconsistent`, never as linked.
    if (byMdm.state === 'inconsistent' || byCm.state === 'inconsistent') incomplete();
    if (byMdm.mdmId !== mdmId || byCm.cmUserId !== cmUserId || !samePair(byMdm, byCm)) incomplete();
    if (direction === 'historical') {
      if (byMdm.state !== 'linked' && byMdm.state !== 'removed') incomplete();
      return;
    }
    if (byMdm.state === 'removed') removed();
    if (byMdm.state !== 'linked') incomplete();
  }

  async function confirmPair(mdmId: string, cmUserId: string, direction: Direction): Promise<void> {
    const result = await transport(() => client.resolveModulePeople(asUserId, {
      mdmIds: [mdmId],
      cmUserIds: [cmUserId],
    }));
    const people = peopleOf(result);
    if (people.length !== 2) incomplete();
    checkPair(people[0], people[1], mdmId, cmUserId, direction);
  }

  async function toCmUserId(ctx: RequestContext, mdmId: string): Promise<string> {
    assertContext(ctx);
    if (idText(mdmId) === undefined) protocol();
    const person = await resolveOne({ mdmIds: [mdmId] }, { mdmId });
    if (person.state === 'inconsistent') incomplete();
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
    if (again.state === 'inconsistent') incomplete();
    if (again.state === 'removed') removed();
    if (again.state !== 'linked' || again.cmUserId !== cmUserId) incomplete();
    await confirmPair(mdmId, cmUserId, 'forward');
    return cmUserId;
  }

  async function toMdmId(ctx: RequestContext, userId: string): Promise<string> {
    assertContext(ctx);
    if (idText(userId) === undefined) protocol();
    const person = await resolveOne({ cmUserIds: [userId] }, { cmUserId: userId });
    if (person.state === 'inconsistent') incomplete();
    if (person.state === 'unlinked') unlinked();
    if (person.mdmId === undefined || person.cmUserId === undefined) protocol();
    await confirmPair(person.mdmId, person.cmUserId, person.state === 'removed' ? 'historical' : 'forward');
    return person.mdmId;
  }

  /**
   * `toCmUserId` for many people at once: at most two calls to the cm for the people already linked, whatever the count
   * (one resolves every distinct person, one confirms every linked pair). A person not linked yet goes through
   * `toCmUserId`, one by one, at its place in the order. The first refusal in the order given decides the error, with
   * the rule `toCmUserId` has for that person; nothing is returned in part.
   */
  async function toCmUserIds(ctx: RequestContext, mdmIds: readonly string[]): Promise<Map<string, string>> {
    assertContext(ctx);
    const distinct: string[] = [];
    for (const mdmId of mdmIds) {
      if (idText(mdmId) === undefined) protocol();
      if (!distinct.includes(mdmId)) distinct.push(mdmId);
    }
    const out = new Map<string, string>();
    if (distinct.length === 0) return out;

    const resolved = peopleOf(await transport(() => client.resolveModulePeople(asUserId, { mdmIds: distinct })));
    if (resolved.length !== distinct.length) protocol();
    const byMdm = new Map<string, Person>();
    for (const person of resolved) {
      if (person.mdmId === undefined || !distinct.includes(person.mdmId) || byMdm.has(person.mdmId)) protocol();
      byMdm.set(person.mdmId, person);
    }

    // What `toCmUserId` would do with each person; a refusal is kept as the error it throws.
    type Plan = { kind: 'linked'; cmUserId: string } | { kind: 'unlinked' } | { kind: 'refused'; error: unknown };
    const plan = new Map<string, Plan>();
    for (const mdmId of distinct) {
      const person = byMdm.get(mdmId) as Person;
      try {
        if (person.state === 'inconsistent') incomplete();
        if (person.state === 'removed') {
          if (person.cmUserId === undefined) protocol();
          removed();
        }
        if (person.state === 'linked') {
          if (person.cmUserId === undefined) protocol();
          plan.set(mdmId, { kind: 'linked', cmUserId: person.cmUserId });
          continue;
        }
        if (person.cmUserId !== undefined) protocol();
        plan.set(mdmId, { kind: 'unlinked' });
      } catch (error) {
        plan.set(mdmId, { kind: 'refused', error });
        break; // nothing after the first refusal is looked at
      }
    }

    // One confirmation for every linked pair that comes before the first refusal.
    const linked = distinct.flatMap((mdmId) => {
      const step = plan.get(mdmId);
      return step?.kind === 'linked' ? [{ mdmId, cmUserId: step.cmUserId }] : [];
    });
    const checked = new Map<string, unknown>();
    if (linked.length > 0) {
      const mdmList = linked.map((pair) => pair.mdmId);
      const cmList = [...new Set(linked.map((pair) => pair.cmUserId))];
      const confirmed = peopleOf(await transport(() => client.resolveModulePeople(asUserId, { mdmIds: mdmList, cmUserIds: cmList })));
      let shape: unknown;
      const confirmedByMdm = new Map<string, Person>();
      const confirmedByCm = new Map<string, Person>();
      try {
        if (confirmed.length !== mdmList.length + cmList.length) incomplete();
        for (const person of confirmed.slice(0, mdmList.length)) {
          if (person.mdmId === undefined || confirmedByMdm.has(person.mdmId)) incomplete();
          confirmedByMdm.set(person.mdmId, person);
        }
        for (const person of confirmed.slice(mdmList.length)) {
          if (person.cmUserId === undefined || confirmedByCm.has(person.cmUserId)) incomplete();
          confirmedByCm.set(person.cmUserId, person);
        }
      } catch (error) {
        shape = error;
      }
      for (const pair of linked) {
        try {
          if (shape !== undefined) throw shape;
          const left = confirmedByMdm.get(pair.mdmId);
          const right = confirmedByCm.get(pair.cmUserId);
          if (left === undefined || right === undefined) incomplete();
          checkPair(left, right, pair.mdmId, pair.cmUserId, 'forward');
        } catch (error) {
          checked.set(pair.mdmId, error);
        }
      }
    }

    // The order given decides: each person is settled where it stands, the unlinked ones one by one.
    for (const mdmId of distinct) {
      const step = plan.get(mdmId);
      if (step === undefined) break;
      if (step.kind === 'refused') throw step.error;
      if (step.kind === 'unlinked') {
        out.set(mdmId, await toCmUserId(ctx, mdmId));
        continue;
      }
      if (checked.has(mdmId)) throw checked.get(mdmId);
      out.set(mdmId, step.cmUserId);
    }
    return out;
  }

  /** What `toMdmId` decides for one resolved person: the pair to confirm, or the error it throws. */
  function judge(person: Person): { mdmId: string; cmUserId: string; direction: Direction } {
    if (person.state === 'inconsistent') incomplete();
    if (person.state === 'unlinked') unlinked();
    if (person.mdmId === undefined || person.cmUserId === undefined) protocol();
    return { mdmId: person.mdmId, cmUserId: person.cmUserId, direction: person.state === 'removed' ? 'historical' : 'forward' };
  }

  /**
   * `toMdmId` for many users at once: at most two calls to the cm, whatever the count, with the same rule per person.
   * One call resolves every distinct user; one call confirms every resolved pair. The first person, in the order given,
   * that `toMdmId` would refuse decides the error, and no partial result is returned. The cm answers `mdmIds` first and
   * `cmUserIds` after, one entry per id; the entries are matched by id, never by position.
   */
  async function toMdmIds(ctx: RequestContext, userIds: readonly string[]): Promise<Map<string, string>> {
    assertContext(ctx);
    const distinct: string[] = [];
    for (const userId of userIds) {
      if (idText(userId) === undefined) protocol();
      if (!distinct.includes(userId)) distinct.push(userId);
    }
    const out = new Map<string, string>();
    if (distinct.length === 0) return out;

    const resolved = peopleOf(await transport(() => client.resolveModulePeople(asUserId, { cmUserIds: distinct })));
    if (resolved.length !== distinct.length) protocol();
    const byUser = new Map<string, Person>();
    for (const person of resolved) {
      if (person.cmUserId === undefined || !distinct.includes(person.cmUserId) || byUser.has(person.cmUserId)) protocol();
      byUser.set(person.cmUserId, person);
    }

    // Every user is judged as `toMdmId` would, in order; the first refusal ends the list of pairs to confirm.
    const pairs: Array<{ userId: string; mdmId: string; cmUserId: string; direction: Direction }> = [];
    let refusal: unknown;
    for (const userId of distinct) {
      try {
        pairs.push({ userId, ...judge(byUser.get(userId) as Person) });
      } catch (error) {
        refusal = error;
        break;
      }
    }
    if (pairs.length > 0) {
      const mdmIds = [...new Set(pairs.map((pair) => pair.mdmId))];
      const cmUserIds = [...new Set(pairs.map((pair) => pair.cmUserId))];
      const confirmed = peopleOf(await transport(() => client.resolveModulePeople(asUserId, { mdmIds, cmUserIds })));
      if (confirmed.length !== mdmIds.length + cmUserIds.length) incomplete();
      const byMdm = new Map<string, Person>();
      for (const person of confirmed.slice(0, mdmIds.length)) {
        if (person.mdmId === undefined || byMdm.has(person.mdmId)) incomplete();
        byMdm.set(person.mdmId, person);
      }
      const byCm = new Map<string, Person>();
      for (const person of confirmed.slice(mdmIds.length)) {
        if (person.cmUserId === undefined || byCm.has(person.cmUserId)) incomplete();
        byCm.set(person.cmUserId, person);
      }
      for (const pair of pairs) {
        const left = byMdm.get(pair.mdmId);
        const right = byCm.get(pair.cmUserId);
        if (left === undefined || right === undefined) incomplete();
        checkPair(left, right, pair.mdmId, pair.cmUserId, pair.direction);
        out.set(pair.userId, pair.mdmId);
      }
    }
    if (refusal !== undefined) throw refusal;
    return out;
  }

  return { toCmUserId, toCmUserIds, toMdmId, toMdmIds };
}
