/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/registrationCandidates.ts" enhancement="_blank" />
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type {
  ContactSummaryValue,
  MdmDetailRecord,
  MdmRelationshipRecord,
} from '/_102034_/l1/mdm/module.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmDocumentStore.js';
import type { RegistrationCandidateRef } from '/_102034_/l1/mdm/layer_3_usecases/registrationContracts.js';

export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function todayFromClock(ctx: RequestContext): string {
  return ctx.clock.nowIso().slice(0, 10);
}

function isEmailChannel(detail: MdmDetailRecord): boolean {
  const contactType = detail.contactType;
  return detail.subtype === 'ContactChannel'
    && typeof contactType === 'string'
    && contactType.trim().toLowerCase() === 'email';
}

/** Active HasContact whose date window contains the clock's calendar day. */
function hasContactInForce(relationship: MdmRelationshipRecord, today: string): boolean {
  if (relationship.type !== 'HasContact' || relationship.status !== 'Active') {
    return false;
  }
  if (relationship.validFrom > today) {
    return false;
  }
  return relationship.validTo == null || relationship.validTo >= today;
}

/**
 * Every Person that owns a ContactChannel for this email.
 * Owners come from an in-force HasContact or from a persisted ContactSummary
 * that points at that same channel. Companies and other channels are ignored.
 * The list is deduped. Nothing here creates or links a login.
 */
export async function findRegistrationCandidates(
  ctx: RequestContext,
  email: string,
): Promise<RegistrationCandidateRef[]> {
  const normalized = normalizeRegistrationEmail(email);
  if (!normalized) {
    return [];
  }

  const channelIndexes = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'ContactChannel' } });
  const channelDocuments = await ctx.data.mdmDocument.getMany({
    mdmIds: channelIndexes.map((index) => index.mdmId),
  });
  const channelIds = new Set<string>();
  for (const document of channelDocuments) {
    const detail = MdmDocumentEntity.parseDetails(document);
    if (!isEmailChannel(detail)) {
      continue;
    }
    const value = detail.value;
    if (typeof value === 'string' && normalizeRegistrationEmail(value) === normalized) {
      channelIds.add(detail.mdmId);
    }
  }
  if (channelIds.size === 0) {
    return [];
  }

  const today = todayFromClock(ctx);
  const relationships = await ctx.data.mdmRelationship.findMany();
  const ownerIds = new Set<string>();
  for (const relationship of relationships) {
    if (!channelIds.has(relationship.toId) || !hasContactInForce(relationship, today)) {
      continue;
    }
    ownerIds.add(relationship.fromId);
  }

  const personIndexes = await ctx.data.mdmEntityIndex.findMany({ where: { subtype: 'Person' } });
  const personIds = personIndexes.map((index) => index.mdmId);
  const personDocuments = await ctx.data.mdmDocument.getMany({ mdmIds: personIds });
  const personsById = new Map(personDocuments.map((document) => [document.mdmId, document]));

  for (const document of personDocuments) {
    const detail = MdmDocumentEntity.parseDetails(document);
    if (detail.subtype !== 'Person') {
      continue;
    }
    const summaries = detail.contacts ?? [];
    if (summaries.some((summary: ContactSummaryValue) => channelIds.has(summary.mdmId))) {
      ownerIds.add(detail.mdmId);
    }
  }

  const candidates: string[] = [];
  for (const mdmId of ownerIds) {
    const document = personsById.get(mdmId);
    if (!document) {
      continue;
    }
    const detail = MdmDocumentEntity.parseDetails(document);
    if (detail.subtype === 'Person') {
      candidates.push(detail.mdmId);
    }
  }

  candidates.sort();
  return candidates.map((mdmId) => ({ mdmId }));
}
