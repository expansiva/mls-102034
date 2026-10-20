/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/MdmIdentityUsersMemory.ts" enhancement="_blank" />
import type { MdmDocumentRecord, MdmEntityIndexRecord, MdmTagRecord } from '/_102034_/l1/mdm/module.js';
import {
  foldUserName,
  type MdmIdentityUserReader,
  type MdmUserDirectoryQuery,
  type MdmUserDirectoryRow,
  type MdmUserStatus,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsersContracts.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

const LOGIN_ENTITY_TYPE = 'MdmEntity';
const LOGIN_NAMESPACE = 'login';
const LOGIN_MODULE = 'organization';
const PERSON_SUBTYPE = 'Person';
const DOCUMENT_CHUNK = 100;

function compareMdmId(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isCanonicalLoginTag(tag: MdmTagRecord): boolean {
  return tag.entityType === LOGIN_ENTITY_TYPE
    && tag.namespace === LOGIN_NAMESPACE
    && tag.module === LOGIN_MODULE;
}

function indexTags(record: MdmEntityIndexRecord): string[] {
  return Array.isArray(record.tags) ? record.tags : [];
}

function passesFilters(record: MdmEntityIndexRecord, query: MdmUserDirectoryQuery): boolean {
  if (query.status !== 'all' && record.status !== query.status) {
    return false;
  }
  if (query.roleTag) {
    const has = indexTags(record).includes(query.roleTag);
    const want = query.roleTagMode === 'without' ? !has : has;
    if (!want) {
      return false;
    }
  }
  if (query.foldedName && !foldUserName(record.name ?? '').includes(query.foldedName)) {
    return false;
  }
  if (query.afterMdmId && compareMdmId(record.mdmId, query.afterMdmId) <= 0) {
    return false;
  }
  return true;
}

async function documentsById(runtime: IDataRuntime, mdmIds: readonly string[]): Promise<Map<string, MdmDocumentRecord>> {
  const found = new Map<string, MdmDocumentRecord>();
  for (let offset = 0; offset < mdmIds.length; offset += DOCUMENT_CHUNK) {
    const chunk = mdmIds.slice(offset, offset + DOCUMENT_CHUNK);
    const documents = await runtime.mdmDocument.getMany({ mdmIds: [...chunk] });
    for (const document of documents) {
      found.set(document.mdmId, document);
    }
  }
  return found;
}

function rowOf(
  record: MdmEntityIndexRecord,
  document: MdmDocumentRecord | undefined,
  loginTags: readonly string[],
): MdmUserDirectoryRow {
  const details = document?.details;
  return {
    mdmId: record.mdmId,
    name: record.name,
    status: record.status as MdmUserStatus,
    tags: indexTags(record),
    version: document ? document.version : null,
    documentMdmId: document ? document.mdmId : null,
    documentSubtype: details && typeof details.subtype === 'string' ? details.subtype : null,
    contacts: details && 'contacts' in details ? details.contacts : null,
    loginTags: [...loginTags],
  };
}

/** Reads users from the tables of the given runtime. Does not open another store. */
export function createMemoryMdmIdentityUsersReader(runtime: IDataRuntime): MdmIdentityUserReader {
  return {
    async listPage(query: MdmUserDirectoryQuery): Promise<MdmUserDirectoryRow[]> {
      const tagRows = await runtime.mdmTag.findMany();
      const loginTagsByEntity = new Map<string, string[]>();
      for (const tag of tagRows) {
        if (!isCanonicalLoginTag(tag) || !tag.entityId) {
          continue;
        }
        const current = loginTagsByEntity.get(tag.entityId);
        if (current) {
          current.push(tag.tag);
        } else {
          loginTagsByEntity.set(tag.entityId, [tag.tag]);
        }
      }

      const people = await runtime.mdmEntityIndex.findMany({ where: { subtype: PERSON_SUBTYPE } });
      const byId = new Map<string, MdmEntityIndexRecord>();
      for (const person of people) {
        if (!loginTagsByEntity.has(person.mdmId) || byId.has(person.mdmId)) {
          continue;
        }
        if (!passesFilters(person, query)) {
          continue;
        }
        byId.set(person.mdmId, person);
      }

      const ordered = [...byId.values()].sort((left, right) => compareMdmId(left.mdmId, right.mdmId));
      const page = ordered.slice(0, query.limit);
      const documents = await documentsById(runtime, page.map((person) => person.mdmId));
      return page.map((person) => rowOf(person, documents.get(person.mdmId), loginTagsByEntity.get(person.mdmId) ?? []));
    },
  };
}
