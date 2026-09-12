/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/mdmFacade.ts" enhancement="_blank" />
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { MdmDocumentEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmDocumentStore.js';
import { MdmRecordEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmRecordStore.js';
import { MdmRelationshipEntity } from '/_102034_/l1/mdm/layer_3_usecases/internal/MdmRelationshipStore.js';
import {
  createEntity,
  createProspect,
  enqueueWriteBehind,
  getProspect,
  promoteProspect,
  updateEntity,
  updateProspect,
} from '/_102034_/l1/mdm/layer_3_usecases/internal/entityPersistence.js';
import { createRelationship, updateRelationship } from '/_102034_/l1/mdm/layer_3_usecases/internal/relationshipPersistence.js';
import {
  attachFile, detachFile, findAttachmentsByEntity,
} from '/_102034_/l1/mdm/layer_3_usecases/attachmentUsecases.js';
import {
  AuditLogService,
  runMonitoredWrite,
} from '/_102034_/l1/mdm/layer_3_usecases/core/DataRecordService.js';
import {
  getMdmModuleTypes,
  refreshRelationshipRefs,
} from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import {
  MDM_GENERAL_NAMESPACE,
  MDM_ORGANIZATION_MODULE_ID,
} from '/_102034_/l1/mdm/module.js';
import type {
  AttachFileParams,
  DetachFileParams,
  FindAttachmentsByEntityParams,
  MdmAttachmentRecord,
  CompactRelationshipRefKey,
  CreateableMdmDetailInput,
  MdmDetailRecord,
  MdmDocumentRecord,
  MdmEntityIndexRecord,
  MdmModuleNamespaceValue,
  MdmProspectIndexRecord,
  MdmRelationshipRecord,
  RelationshipStatus,
} from '/_102034_/l1/mdm/module.js';
import type { MdmProspectStatus, MdmStatus, MdmSubtype, RelationshipType } from '/_102034_/l1/mdm/defs/ontology.js';
import {
  findByLogin,
  invite,
  setLogin,
  type MdmIdentityInviteInput,
  type MdmIdentityInviteResult,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';

const DEFAULT_GET_MANY_CHUNK_SIZE = 100;

export type MdmEntityCreateDetails = Omit<CreateableMdmDetailInput, 'status'> &
  Partial<Pick<CreateableMdmDetailInput, 'status'>>;

export interface MdmEntityCreateInput {
  details: MdmEntityCreateDetails;
}

export type MdmProspectCreateDetails = Omit<CreateableMdmDetailInput, 'status'> &
  Partial<Pick<CreateableMdmDetailInput, 'status'>>;

export interface MdmProspectCreateInput {
  details: MdmProspectCreateDetails;
}

export interface MdmEntityUpdateInput {
  mdmId: string;
  expectedVersion: number;
  patch: Partial<MdmDetailRecord>;
}

export interface MdmProspectUpdateInput extends MdmEntityUpdateInput {}

export interface MdmEntityGetInput {
  mdmId: string;
}

export interface MdmProspectGetInput extends MdmEntityGetInput {}

export interface MdmProspectPromoteToEntityInput {
  mdmId: string;
}

export interface MdmEntityInactivateInput {
  mdmId: string;
  expectedVersion: number;
  reason?: string | null;
}

/** Mirror of MdmEntityInactivateInput: the cadastral cycle is symmetric, so its input is too. */
export interface MdmEntityReactivateInput {
  mdmId: string;
  expectedVersion: number;
  reason?: string | null;
}

export interface MdmEntityDeleteInput {
  mdmId: string;
  allowActiveRelationships?: boolean;
}

export interface MdmLinkInput {
  fromId: string;
  toId: string;
  type: RelationshipType;
  role?: string | null;
  metadata?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string | null;
  status?: RelationshipStatus;
  isBidirectional?: boolean;
}

export interface MdmUnlinkInput {
  relationshipId: string;
}

export interface MdmGetManyInput {
  mdmIds: string[];
  chunkSize?: number;
}

export interface MdmListByTypeInput {
  type: string;
  subtype?: MdmSubtype;
  tags?: string[];
  status?: MdmStatus;
  name?: string;
  page?: number;
  pageSize?: number;
  sort?: {
    field: 'name' | 'createdAt' | 'updatedAt' | 'status';
    direction: 'asc' | 'desc';
  };
}

export interface MdmProspectListByTypeInput {
  type: string;
  subtype?: MdmSubtype;
  tags?: string[];
  status?: MdmProspectStatus;
  name?: string;
  page?: number;
  pageSize?: number;
  sort?: {
    field: 'name' | 'createdAt' | 'updatedAt' | 'status';
    direction: 'asc' | 'desc';
  };
}

export interface MdmHydrateManyInput extends MdmGetManyInput {
  sections?: string[];
  includeRelationshipRefs?: boolean;
}

export interface MdmRelatedOfManyInput {
  mdmIds: string[];
  type?: RelationshipType;
  status?: RelationshipStatus;
}

export interface MdmRelatedRef {
  mdmId: string;
  relationshipId: string;
  type: RelationshipType;
  direction: 'from' | 'to';
  role?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MdmEntityReadResult {
  mdmId: string;
  version: number;
  document: MdmDocumentRecord;
  index: MdmEntityIndexRecord;
  details: MdmDetailRecord;
  related(key: CompactRelationshipRefKey): string[];
}

export interface MdmEntityWriteResult extends MdmEntityReadResult {
  alreadyExists?: boolean;
}

export interface MdmProspectReadResult {
  mdmId: string;
  version: number;
  document: MdmDocumentRecord;
  index: MdmProspectIndexRecord;
  details: MdmDetailRecord;
  related(key: CompactRelationshipRefKey): string[];
}

export interface MdmProspectWriteResult extends MdmProspectReadResult {}

export type MdmProspectListByTypeItem = MdmProspectIndexRecord & { details: MdmDetailRecord };

export interface MdmProspectListByTypeResult {
  items: MdmProspectListByTypeItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MdmProspectPromoteToEntityResult {
  promoted: boolean;
  status: MdmStatus | MdmProspectStatus;
  mdmId: string;
  prospectMdmId?: string;
  candidateMdmId?: string;
}

export interface MdmDeleteResult {
  mdmId: string;
  deleted: true;
}

export type MdmListByTypeItem = MdmEntityIndexRecord & { details: MdmDetailRecord };

export interface MdmListByTypeResult {
  items: MdmListByTypeItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MdmHydratedEntity {
  mdmId: string;
  version: number;
  details: Partial<MdmDetailRecord>;
}

export interface MdmFacade {
  entity: MdmEntity;
  prospect: MdmProspect;
  collection: MdmCollection;
  attachment: MdmAttachment;
  identity: MdmIdentity;
}

/**
 * Typed platform keys of BaseMdmDetailRecord and the *DetailRecord variants.
 * Anything else in `details` is a module namespace (or the reserved `general`).
 */
const MDM_PLATFORM_DETAIL_KEYS = new Set<string>([
  'mdmId', 'subtype', 'name', 'status', 'moduleTypes', 'docType', 'docId',
  'countryCode', 'tags', 'aliases', 'contacts', 'relationshipRefs', 'addresses',
  'mergedInto', 'createdAt', 'updatedAt',
  'privacyConsent', 'birthDate', 'gender', 'nationality', 'occupation', 'photoUrl', 'notes',
  'companyKind', 'parentCompanyId', 'externalCode', 'legalName', 'tradeName', 'legalType',
  'foundingDate', 'taxRegime', 'industryCode', 'website',
  'sku', 'productType', 'category', 'brand', 'unitOfMeasure', 'isInventoried',
  'serviceCode', 'serviceKind', 'parentServiceId', 'serviceType', 'durationMinutes', 'deliveryMode',
  'locationType', 'locationCode', 'parentLocationId', 'capacity', 'propertyAddress',
  'assetCategory', 'serialNumber', 'manufacturer', 'model',
  'contactType', 'value', 'isVerified', 'verifiedAt',
  'storageBucket', 'storagePath', 'originModule', 'docCategory', 'fileName', 'mimeType',
  'bankRoutingNumber', 'bankName', 'accountNumber', 'accountType', 'swift', 'iban',
  'pixKey', 'pixKeyType',
  'promotionSource', 'promotedTo', 'ttlExpiresAt',
]);

const MDM_COMPUTED_DETAIL_KEYS = new Set<string>(['namespaces']);

export function isUnrestrictedMdmCaller(moduleId?: string | null): boolean {
  return !moduleId || moduleId === MDM_ORGANIZATION_MODULE_ID;
}

export function projectDetailsForModule(
  details: MdmDetailRecord | Record<string, unknown>,
  moduleId?: string | null,
): MdmDetailRecord {
  const source = details as Record<string, unknown>;
  const namespaces: string[] = [];
  const unrestricted = isUnrestrictedMdmCaller(moduleId);
  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (MDM_COMPUTED_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (MDM_PLATFORM_DETAIL_KEYS.has(key) || key === MDM_GENERAL_NAMESPACE) {
      projected[key] = value;
      continue;
    }
    if (unrestricted || key === moduleId) {
      projected[key] = value;
    }
    if (unrestricted || key !== moduleId) {
      namespaces.push(key);
    }
  }
  namespaces.sort();
  projected.namespaces = namespaces;
  return projected as MdmDetailRecord;
}

function assertWritableMdmNamespaces(
  details: Record<string, unknown>,
  moduleId?: string | null,
): void {
  if (isUnrestrictedMdmCaller(moduleId)) {
    return;
  }
  for (const key of Object.keys(details)) {
    if (MDM_COMPUTED_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (MDM_PLATFORM_DETAIL_KEYS.has(key) || key === MDM_GENERAL_NAMESPACE || key === moduleId) {
      continue;
    }
    throw new AppError(
      'MDM_FOREIGN_NAMESPACE',
      'MDM namespace writes are limited to the caller module and general',
      400,
      { moduleId, key },
    );
  }
}

function prepareMdmWriteDetails<T extends Record<string, unknown>>(
  details: T,
  moduleId?: string | null,
): T {
  const prepared = { ...details } as T & { namespaces?: unknown };
  delete prepared.namespaces;
  assertWritableMdmNamespaces(prepared as Record<string, unknown>, moduleId);
  return prepared;
}

async function attachProjectedDetailsToIndexPage<TIndex extends { mdmId: string }>(
  ctx: RequestContext,
  items: TIndex[],
): Promise<Array<TIndex & { details: MdmDetailRecord }>> {
  if (items.length === 0) {
    return [];
  }
  const documents = await ctx.data.mdmDocument.getMany({
    mdmIds: items.map((item) => item.mdmId),
  });
  const documentById = new Map(documents.map((document) => [document.mdmId, document]));
  return items.map((item) => {
    const document = documentById.get(item.mdmId);
    const details = document
      ? projectDetailsForModule(MdmDocumentEntity.parseDetails(document), ctx.moduleId)
      : projectDetailsForModule({}, ctx.moduleId);
    return { ...item, details };
  });
}

function buildReadResult(
  ctx: RequestContext,
  document: MdmDocumentRecord,
  index: MdmEntityIndexRecord,
): MdmEntityReadResult {
  const details = projectDetailsForModule(MdmDocumentEntity.parseDetails(document), ctx.moduleId);
  return {
    mdmId: document.mdmId,
    version: document.version,
    document: { ...document, details },
    index,
    details,
    related(key) {
      return details.relationshipRefs[key] ?? [];
    },
  };
}

function buildProspectReadResult(
  ctx: RequestContext,
  document: MdmDocumentRecord,
  index: MdmProspectIndexRecord,
): MdmProspectReadResult {
  const details = projectDetailsForModule(MdmDocumentEntity.parseDetails(document), ctx.moduleId);
  return {
    mdmId: document.mdmId,
    version: document.version,
    document: { ...document, details },
    index,
    details,
    related(key) {
      return details.relationshipRefs[key] ?? [];
    },
  };
}

function assertCanonicalModuleType(type: string): void {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(type)) {
    throw new AppError(
      'INVALID_MDM_MODULE_TYPE',
      'type must use the canonical <moduleId>.<type> format',
      400,
      { type },
    );
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

function chunks<TValue>(values: TValue[], size: number): TValue[][] {
  const normalizedSize = Math.max(1, size);
  const result: TValue[][] = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    result.push(values.slice(index, index + normalizedSize));
  }
  return result;
}

function activeRelationships(relationships: MdmRelationshipRecord[]): MdmRelationshipRecord[] {
  return relationships.filter((relationship) => relationship.status === 'Active');
}

function dedupeRelationships(relationships: MdmRelationshipRecord[]): MdmRelationshipRecord[] {
  return relationships.filter(
    (relationship, index, all) => all.findIndex((candidate) => candidate.id === relationship.id) === index,
  );
}

async function findEntityRelationships(
  ctx: RequestContext,
  mdmIds: string[],
): Promise<MdmRelationshipRecord[]> {
  const ids = uniqueIds(mdmIds);
  if (ids.length === 0) {
    return [];
  }

  return dedupeRelationships([
    ...(await ctx.data.mdmRelationship.findManyByValues({ field: 'fromId', values: ids })),
    ...(await ctx.data.mdmRelationship.findManyByValues({ field: 'toId', values: ids })),
  ]);
}

async function assertPermanentEntityLinkEndpoints(
  ctx: RequestContext,
  input: Pick<MdmLinkInput, 'fromId' | 'toId'>,
): Promise<void> {
  const ids = uniqueIds([input.fromId, input.toId]);
  const entityIndexes = await ctx.data.mdmEntityIndex.findManyByValues({
    field: 'mdmId',
    values: ids,
  });
  const entityIds = new Set(entityIndexes.map((index) => index.mdmId));
  const missingIds = ids.filter((id) => !entityIds.has(id));
  if (missingIds.length === 0) {
    return;
  }

  const prospectIndexes = await ctx.data.mdmProspectIndex.findManyByValues({
    field: 'mdmId',
    values: missingIds,
  });
  if (prospectIndexes.length > 0) {
    throw new AppError(
      'INVALID_RELATIONSHIP_SCOPE',
      'MdmEntity.link only supports permanent entity endpoints',
      400,
      {
        fromId: input.fromId,
        toId: input.toId,
        prospectMdmIds: prospectIndexes.map((index) => index.mdmId),
      },
    );
  }

  throw new AppError('VALIDATION_ERROR', 'Relationship endpoints must exist', 400, {
    fromId: input.fromId,
    toId: input.toId,
    missingMdmIds: missingIds,
  });
}

export class MdmEntity {
  public constructor(private readonly ctx: RequestContext) {}

  public async create(input: MdmEntityCreateInput): Promise<MdmEntityWriteResult> {
    const details = prepareMdmWriteDetails(
      input.details as MdmEntityCreateDetails & Record<string, unknown>,
      this.ctx.moduleId,
    );
    const created = await createEntity(this.ctx, {
      detail: {
        ...details,
        status: details.status ?? 'Active',
      } as CreateableMdmDetailInput,
    });
    const entity = await this.get({ mdmId: created.mdmId });
    return {
      ...entity,
      alreadyExists: created.alreadyExists,
    };
  }

  public async get(input: MdmEntityGetInput): Promise<MdmEntityReadResult> {
    const results = await new MdmCollection(this.ctx).getMany({ mdmIds: [input.mdmId] });
    const entity = results[0];
    if (!entity) {
      throw new AppError('NOT_FOUND', 'Entity not found', 404, { mdmId: input.mdmId });
    }

    return entity;
  }

  public async update(input: MdmEntityUpdateInput): Promise<MdmEntityWriteResult> {
    const patch = prepareMdmWriteDetails(
      input.patch as Partial<MdmDetailRecord> & Record<string, unknown>,
      this.ctx.moduleId,
    );
    await updateEntity(this.ctx, {
      mdmId: input.mdmId,
      expectedVersion: input.expectedVersion,
      patch,
    });
    return this.get({ mdmId: input.mdmId });
  }

  public async findByDocument(docType: string, docId: string): Promise<MdmEntityReadResult | null> {
    const index = await MdmRecordEntity.findEntityByDocument(this.ctx, docType, docId);
    if (!index) {
      return null;
    }
    return this.get({ mdmId: index.mdmId });
  }

  public async findByContact(contactType: string, value: string): Promise<MdmEntityReadResult | null> {
    const index = await MdmRecordEntity.findEntityByContact(this.ctx, contactType, value);
    if (!index) {
      return null;
    }
    return this.get({ mdmId: index.mdmId });
  }

  /**
   * Create-or-attach: add tag `<moduleId>.<role>` without duplicating, and optionally write the
   * caller module's namespace. Role may be the entity id (`Cliente`) or the canonical tag.
   */
  public async attachRole(
    mdmId: string,
    role: string,
    namespace?: MdmModuleNamespaceValue,
  ): Promise<MdmEntityWriteResult> {
    const moduleId = this.ctx.moduleId;
    const trimmedRole = role.trim();
    const tag = trimmedRole.includes('.')
      ? trimmedRole
      : (moduleId && !isUnrestrictedMdmCaller(moduleId) ? `${moduleId}.${trimmedRole}` : trimmedRole);
    assertCanonicalModuleType(tag);
    if (moduleId && !isUnrestrictedMdmCaller(moduleId) && !tag.startsWith(`${moduleId}.`)) {
      throw new AppError(
        'MDM_FOREIGN_NAMESPACE',
        'attachRole can only add a tag for the caller module',
        400,
        { moduleId, role: tag },
      );
    }

    const entity = await this.get({ mdmId });
    const tags = [...new Set([...entity.details.tags, tag])];
    const moduleTypes = [...new Set([...getMdmModuleTypes(entity.details), tag])];
    const patch: Partial<MdmDetailRecord> & Record<string, unknown> = { tags, moduleTypes };
    if (namespace !== undefined) {
      if (!moduleId || isUnrestrictedMdmCaller(moduleId)) {
        throw new AppError(
          'MDM_FOREIGN_NAMESPACE',
          'attachRole namespace writes require a caller moduleId',
          400,
          { mdmId },
        );
      }
      patch[moduleId] = namespace;
    }
    return this.update({
      mdmId,
      expectedVersion: entity.version,
      patch,
    });
  }

  public async inactivate(input: MdmEntityInactivateInput): Promise<MdmEntityWriteResult> {
    await updateEntity(this.ctx, {
      mdmId: input.mdmId,
      expectedVersion: input.expectedVersion,
      patch: {
        status: 'Inactive',
      },
    });
    return this.get({ mdmId: input.mdmId });
  }

  /**
   * The other half of the cadastral cycle. An MDM entity is NEVER deleted by a generated module: the
   * tier-1 catalogue emits `inactivate`/`reactivate` for `storage.target: 'mdm'` instead of `delete`,
   * so a generated `cmdReactivate*` had no target here at all until this method existed.
   *
   * Deliberately the exact mirror of `inactivate` — same optimistic version, same single-field patch —
   * because any asymmetry between the two halves shows up as a record that can be hidden and not
   * brought back.
   */
  public async reactivate(input: MdmEntityReactivateInput): Promise<MdmEntityWriteResult> {
    await updateEntity(this.ctx, {
      mdmId: input.mdmId,
      expectedVersion: input.expectedVersion,
      patch: {
        status: 'Active',
      },
    });
    return this.get({ mdmId: input.mdmId });
  }

  public async delete(input: MdmEntityDeleteInput): Promise<MdmDeleteResult> {
    const entity = await this.get({ mdmId: input.mdmId });
    const storedDocument = await MdmDocumentEntity.get(this.ctx, input.mdmId);
    const storedDetails = MdmDocumentEntity.parseDetails(storedDocument);
    const relationships = await findEntityRelationships(this.ctx, [input.mdmId]);
    const active = activeRelationships(relationships);
    if (active.length > 0 && !input.allowActiveRelationships) {
      throw new AppError(
        'MDM_DELETE_BLOCKED_BY_RELATIONSHIPS',
        'Entity has active relationships; inactivate it or unlink relationships before physical delete',
        409,
        {
          mdmId: input.mdmId,
          relationshipIds: active.map((relationship) => relationship.id),
        },
      );
    }

    await runMonitoredWrite(this.ctx, {
      entityType: 'MdmEntity',
      entityId: input.mdmId,
      module: 'mdm',
      routine: 'mdm.entity.delete',
      action: 'delete',
    }, async () => {
      await this.ctx.data.runInTransaction(async (runtime) => {
        const runtimeCtx = { ...this.ctx, data: runtime };
        const relatedIds = relationships
          .flatMap((relationship) => [relationship.fromId, relationship.toId])
          .filter((mdmId) => mdmId !== input.mdmId);

        for (const relationship of relationships) {
          await runtime.mdmRelationship.delete({ where: { id: relationship.id } });
        }
        await runtime.mdmEntityIndex.delete({ where: { mdmId: input.mdmId } });
        await runtime.mdmDocument.delete({ mdmId: input.mdmId });
        await AuditLogService.record(this.ctx, runtime, {
          entityType: 'MdmEntity',
          entityId: input.mdmId,
          action: 'delete',
          module: 'mdm',
          routine: 'mdm.entity.delete',
          before: {
            index: entity.index,
            details: storedDetails,
          },
          after: null,
        });
        await refreshRelationshipRefs(
          runtimeCtx,
          'entity',
          relatedIds,
          async (document) => enqueueWriteBehind(this.ctx, runtime, document),
        );
      });
    });

    return {
      mdmId: input.mdmId,
      deleted: true,
    };
  }

  public async link(input: MdmLinkInput) {
    await assertPermanentEntityLinkEndpoints(this.ctx, input);
    return createRelationship(this.ctx, {
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      role: input.role ?? null,
      metadata: input.metadata ?? {},
      validFrom: input.validFrom ?? this.ctx.clock.nowIso().slice(0, 10),
      validTo: input.validTo ?? null,
      status: input.status ?? 'Active',
      isBidirectional: input.isBidirectional,
    });
  }

  public async unlink(input: MdmUnlinkInput) {
    const located = await MdmRelationshipEntity.findOne(this.ctx, input.relationshipId);
    if (located.scope !== 'entity') {
      throw new AppError('INVALID_RELATIONSHIP_SCOPE', 'MdmEntity.unlink only supports entity relationships', 400, {
        relationshipId: input.relationshipId,
      });
    }

    return updateRelationship(this.ctx, {
      id: input.relationshipId,
      patch: {
        status: 'Inactive',
      },
    });
  }
}

export class MdmProspect {
  public constructor(private readonly ctx: RequestContext) {}

  public async create(input: MdmProspectCreateInput): Promise<MdmProspectWriteResult> {
    const details = prepareMdmWriteDetails(
      input.details as MdmProspectCreateDetails & Record<string, unknown>,
      this.ctx.moduleId,
    );
    const created = await createProspect(this.ctx, {
      detail: {
        ...details,
        status: details.status ?? 'New',
      } as CreateableMdmDetailInput,
    });
    return this.get({ mdmId: created.mdmId });
  }

  public async get(input: MdmProspectGetInput): Promise<MdmProspectReadResult> {
    const result = await getProspect(this.ctx, input.mdmId);
    return buildProspectReadResult(this.ctx, result.document, result.index as MdmProspectIndexRecord);
  }

  public async update(input: MdmProspectUpdateInput): Promise<MdmProspectWriteResult> {
    const patch = prepareMdmWriteDetails(
      input.patch as Partial<MdmDetailRecord> & Record<string, unknown>,
      this.ctx.moduleId,
    );
    await updateProspect(this.ctx, {
      mdmId: input.mdmId,
      expectedVersion: input.expectedVersion,
      patch,
    });
    return this.get({ mdmId: input.mdmId });
  }

  public async listByType(input: MdmProspectListByTypeInput): Promise<MdmProspectListByTypeResult> {
    assertCanonicalModuleType(input.type);
    const records = await this.ctx.data.mdmProspectIndex.findMany({
      where: {
        subtype: input.subtype,
        status: input.status,
      },
      orderBy: input.sort,
    });
    const normalizedName = input.name?.trim().toLowerCase() ?? '';
    const requiredTags = input.tags ?? [];
    const filtered = records.filter((record) => {
      if (!record.tags.includes(input.type)) {
        return false;
      }
      if (requiredTags.some((tag) => !record.tags.includes(tag))) {
        return false;
      }
      if (normalizedName && !record.name.toLowerCase().includes(normalizedName)) {
        return false;
      }
      return true;
    });
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.max(1, input.pageSize ?? (filtered.length || 1));
    const offset = (page - 1) * pageSize;
    const pageItems = filtered.slice(offset, offset + pageSize);

    return {
      items: await attachProjectedDetailsToIndexPage(this.ctx, pageItems),
      page,
      pageSize,
      total: filtered.length,
    };
  }

  public async promoteToEntity(input: MdmProspectPromoteToEntityInput): Promise<MdmProspectPromoteToEntityResult> {
    const result = await promoteProspect(this.ctx, { mdmId: input.mdmId });
    return {
      promoted: result.promoted,
      status: result.status as MdmStatus | MdmProspectStatus,
      mdmId: result.mdmId,
      prospectMdmId: 'prospectMdmId' in result ? result.prospectMdmId : undefined,
      candidateMdmId: 'candidateMdmId' in result ? result.candidateMdmId : undefined,
    };
  }
}

export class MdmCollection {
  public constructor(private readonly ctx: RequestContext) {}

  public async getMany(input: MdmGetManyInput): Promise<MdmEntityReadResult[]> {
    const ids = uniqueIds(input.mdmIds);
    if (ids.length === 0) {
      return [];
    }

    const chunkSize = input.chunkSize ?? DEFAULT_GET_MANY_CHUNK_SIZE;
    const documents = (
      await Promise.all(chunks(ids, chunkSize).map((chunk) => this.ctx.data.mdmDocument.getMany({ mdmIds: chunk })))
    ).flat();
    const indexes = (
      await Promise.all(chunks(ids, chunkSize).map((chunk) => this.ctx.data.mdmEntityIndex.findManyByValues({
        field: 'mdmId',
        values: chunk,
      })))
    ).flat();
    const documentById = new Map(documents.map((document) => [document.mdmId, document]));
    const indexById = new Map(indexes.map((index) => [index.mdmId, index]));
    const results: MdmEntityReadResult[] = [];

    for (const mdmId of input.mdmIds) {
      const document = documentById.get(mdmId);
      if (!document) {
        continue;
      }

      const index = indexById.get(mdmId);
      if (!index) {
        throw new AppError('MDM_INDEX_MISSING', 'Document exists without entity index', 500, { mdmId });
      }

      results.push(buildReadResult(this.ctx, document, index));
    }

    return results;
  }

  public async listByType(input: MdmListByTypeInput): Promise<MdmListByTypeResult> {
    assertCanonicalModuleType(input.type);
    const records = await this.ctx.data.mdmEntityIndex.findMany({
      where: {
        subtype: input.subtype,
        status: input.status,
      },
      orderBy: input.sort,
    });
    const normalizedName = input.name?.trim().toLowerCase() ?? '';
    const requiredTags = input.tags ?? [];
    const filtered = records.filter((record) => {
      if (!record.tags.includes(input.type)) {
        return false;
      }
      if (requiredTags.some((tag) => !record.tags.includes(tag))) {
        return false;
      }
      if (normalizedName && !record.name.toLowerCase().includes(normalizedName)) {
        return false;
      }
      return true;
    });
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.max(1, input.pageSize ?? (filtered.length || 1));
    const offset = (page - 1) * pageSize;
    const pageItems = filtered.slice(offset, offset + pageSize);

    return {
      items: await attachProjectedDetailsToIndexPage(this.ctx, pageItems),
      page,
      pageSize,
      total: filtered.length,
    };
  }

  public async relatedOfMany(input: MdmRelatedOfManyInput): Promise<Record<string, MdmRelatedRef[]>> {
    const ids = uniqueIds(input.mdmIds);
    const relationships = (await findEntityRelationships(this.ctx, ids)).filter((relationship) => {
      if (input.status && relationship.status !== input.status) {
        return false;
      }
      if (!input.status && relationship.status !== 'Active') {
        return false;
      }
      if (input.type && relationship.type !== input.type) {
        return false;
      }
      return true;
    });
    const idSet = new Set(ids);
    const grouped: Record<string, MdmRelatedRef[]> = Object.fromEntries(ids.map((mdmId) => [mdmId, []]));

    for (const relationship of relationships) {
      if (idSet.has(relationship.fromId)) {
        grouped[relationship.fromId]?.push({
          mdmId: relationship.toId,
          relationshipId: relationship.id,
          type: relationship.type,
          direction: 'from',
          role: relationship.role ?? null,
          metadata: relationship.metadata ?? {},
        });
      }
      if (idSet.has(relationship.toId)) {
        grouped[relationship.toId]?.push({
          mdmId: relationship.fromId,
          relationshipId: relationship.id,
          type: relationship.type,
          direction: 'to',
          role: relationship.role ?? null,
          metadata: relationship.metadata ?? {},
        });
      }
    }

    return grouped;
  }

  public async hydrateMany(input: MdmHydrateManyInput): Promise<MdmHydratedEntity[]> {
    const entities = await this.getMany(input);
    const requestedSections = new Set(input.sections ?? []);
    const includeAllSections = requestedSections.size === 0;
    const includeRelationshipRefs = input.includeRelationshipRefs ?? true;

    return entities.map((entity) => {
      const details = entity.details as MdmDetailRecord & Record<string, unknown>;
      const hydrated: Partial<MdmDetailRecord> & Record<string, unknown> = {
        mdmId: details.mdmId,
        subtype: details.subtype,
        name: details.name,
        status: details.status,
        moduleTypes: getMdmModuleTypes(details),
        tags: details.tags,
        namespaces: details.namespaces ?? [],
      };

      if (includeRelationshipRefs) {
        hydrated.relationshipRefs = details.relationshipRefs;
      }

      if (includeAllSections) {
        return {
          mdmId: entity.mdmId,
          version: entity.version,
          details,
        };
      }

      for (const section of requestedSections) {
        if (section in details) {
          hydrated[section] = details[section];
        }
      }

      return {
        mdmId: entity.mdmId,
        version: entity.version,
        details: hydrated,
      };
    });
  }
}

/**
 * Attachments of any record, through the facade.
 *
 * The usecases already existed (`attachFile`/`detachFile`/`findAttachmentsByEntity`, with write-behind and
 * audit) but nothing in a generated module could reach them: `ctx.mdm` exposed only entity/prospect/
 * collection. This is the wiring, nothing more — no new rule, no new storage.
 *
 * An attachment is ORTHOGONAL to the record it belongs to (`entityType` + `entityId` + `category`), which
 * is why a photo never becomes a field of the ontology. AUTHORIZATION v1 is the owner's: whoever may read
 * or edit the record may list and attach — the caller has already been through the route's own gate, and a
 * finer rule needs the party/dataScope work that is not here yet.
 *
 * The BYTES are not this API's business: it registers metadata plus a `storageKey`. Uploading through
 * `/execBff` (JSON) is never right; that is what the presigned-URL entry point is for.
 */
export class MdmAttachment {
  public constructor(private readonly ctx: RequestContext) {}

  public async attach(input: AttachFileParams): Promise<MdmAttachmentRecord> {
    return attachFile(this.ctx, input);
  }

  public async detach(input: DetachFileParams): Promise<{ id: string; deleted: true }> {
    await detachFile(this.ctx, input);
    return { id: input.id, deleted: true };
  }

  /**
   * LIVE attachments of a record (optionally one category).
   *
   * `detach` is a SOFT delete — it stamps `deletedAt` — and the underlying query does not filter it, so a
   * gallery built straight on it would keep showing a photo the user removed. Filtering here keeps the
   * usecase (and the existing `mdm.attachment.*` route, which returns the full history) untouched, and
   * `includeDetached` is there for whoever wants the history on purpose.
   */
  public async listByEntity(
    input: FindAttachmentsByEntityParams & { includeDetached?: boolean },
  ): Promise<MdmAttachmentRecord[]> {
    const records = await findAttachmentsByEntity(this.ctx, input);
    return input.includeDetached ? records : records.filter(record => !record.deletedAt);
  }
}

export class MdmIdentity {
  public constructor(private readonly ctx: RequestContext) {}

  public findByLogin(email: string): Promise<string | null> {
    return findByLogin(this.ctx, email);
  }

  public setLogin(mdmId: string, email: string): Promise<{ mdmId: string; email: string }> {
    return setLogin(this.ctx, mdmId, email);
  }

  public invite(input: MdmIdentityInviteInput): Promise<MdmIdentityInviteResult> {
    return invite(this.ctx, input);
  }
}

export function createMdmFacade(ctx: RequestContext): MdmFacade {
  return {
    entity: new MdmEntity(ctx),
    prospect: new MdmProspect(ctx),
    collection: new MdmCollection(ctx),
    attachment: new MdmAttachment(ctx),
    identity: new MdmIdentity(ctx),
  };
}
