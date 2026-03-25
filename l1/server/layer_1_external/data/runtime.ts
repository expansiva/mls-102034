/// <mls fileReference="_102034_/l1/server/layer_1_external/data/runtime.ts" enhancement="_blank" />
import type {
  MdmAuditLogIndexRecord,
  MdmAttachmentRecord,
  MdmCommentRecord,
  MdmDocumentRecord,
  MdmErrorLogRecord,
  MdmEntityIndexRecord,
  MdmMonitoringWriteRecord,
  MdmNumberSequenceRecord,
  MdmOutboxRecord,
  MdmProspectIndexRecord,
  MdmRelationshipRecord,
  MdmStatusHistoryRecord,
  MdmTagRecord,
} from '/_102034_/l1/mdm/module.js';
import type { IFindManyInput, IModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';

export interface ITableRuntime<TRecord> {
  findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null>;
  findMany(input?: IFindManyInput<TRecord>): Promise<TRecord[]>;
  findManyByValues<TKey extends keyof TRecord>(input: {
    field: TKey;
    values: Array<NonNullable<TRecord[TKey]>>;
    limit?: number;
  }): Promise<TRecord[]>;
  insert(input: { record: TRecord }): Promise<void>;
  update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void>;
  delete(input: { where: Partial<TRecord> }): Promise<void>;
}

export interface IDocumentRuntime {
  get(input: { mdmId: string }): Promise<MdmDocumentRecord | null>;
  getMany(input: { mdmIds: string[] }): Promise<MdmDocumentRecord[]>;
  put(input: {
    record: MdmDocumentRecord;
    expectedVersion?: number | null;
  }): Promise<void>;
  delete(input: { mdmId: string }): Promise<void>;
}

export interface IQueueRuntime {
  publish(input: { topic: string; payload: unknown }): Promise<void>;
  list(input?: { topic?: string }): Promise<Array<{ topic: string; payload: unknown }>>;
}

export interface IDataRuntime {
  mode: 'memory' | 'postgres';
  mdmDocument: IDocumentRuntime;
  mdmEntityIndex: ITableRuntime<MdmEntityIndexRecord>;
  mdmProspectIndex: ITableRuntime<MdmProspectIndexRecord>;
  mdmRelationship: ITableRuntime<MdmRelationshipRecord>;
  mdmProspectRelationship: ITableRuntime<MdmRelationshipRecord>;
  mdmAuditLog: ITableRuntime<MdmAuditLogIndexRecord>;
  mdmComment: ITableRuntime<MdmCommentRecord>;
  mdmAttachment: ITableRuntime<MdmAttachmentRecord>;
  mdmNumberSequence: ITableRuntime<MdmNumberSequenceRecord>;
  mdmMonitoringWrite: ITableRuntime<MdmMonitoringWriteRecord>;
  mdmErrorLog: ITableRuntime<MdmErrorLogRecord>;
  mdmStatusHistory: ITableRuntime<MdmStatusHistoryRecord>;
  mdmTag: ITableRuntime<MdmTagRecord>;
  mdmOutbox: ITableRuntime<MdmOutboxRecord>;
  pgQueue: IQueueRuntime;
  moduleData: IModuleDataRuntime;
  runInTransaction<TValue>(callback: (runtime: IDataRuntime) => Promise<TValue>): Promise<TValue>;
}
