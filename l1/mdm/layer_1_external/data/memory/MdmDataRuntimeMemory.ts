/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.ts" enhancement="_blank" />
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { projectsConfigExists } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { createMemoryModuleDataRuntime } from '/_102034_/l1/server/layer_1_external/data/moduleDataRuntime.js';
import { findResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import type {
  IDataRuntime,
  IDocumentRuntime,
  IQueueRuntime,
  ITableRuntime,
} from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import type {
  MdmAuditLogIndexRecord,
  MdmAttachmentRecord,
  MdmCommentRecord,
  MdmDocumentRecord,
  MdmDocumentInput,
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

async function loadSeedRows<TRecord>(env: AppEnv, repositoryName: string): Promise<TRecord[]> {
  if (!projectsConfigExists()) {
    return [];
  }

  try {
    const definition = await findResolvedTableDefinition(repositoryName, env);
    return (definition.seedRows ?? []).map((row) => ({ ...row }) as TRecord);
  } catch {
    return [];
  }
}

function matchesWhere<TRecord>(record: TRecord, where?: Partial<TRecord>): boolean {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    return (record as Record<string, unknown>)[key] === value;
  });
}

class TableRuntimeMemory<TRecord> implements ITableRuntime<TRecord> {
  private readonly records: TRecord[] = [];
  private seeded = false;

  public constructor(private readonly seedLoader?: () => Promise<TRecord[]>) {}

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    const rows = this.seedLoader ? await this.seedLoader() : [];
    this.records.push(...rows);
  }

  public async findOne(input: { where: Partial<TRecord> }): Promise<TRecord | null> {
    await this.ensureSeeded();
    const record = this.records.find((current) => matchesWhere(current, input.where));
    return record ? { ...record } : null;
  }

  public async findMany(input?: {
    where?: Partial<TRecord>;
    orderBy?: { field: keyof TRecord; direction: 'asc' | 'desc' };
    limit?: number;
  }): Promise<TRecord[]> {
    await this.ensureSeeded();
    const records = this.records.filter((record) => matchesWhere(record, input?.where));
    if (input?.orderBy) {
      const { field, direction } = input.orderBy;
      records.sort((left, right) => {
        const leftValue = String((left as Record<string, unknown>)[String(field)] ?? '');
        const rightValue = String((right as Record<string, unknown>)[String(field)] ?? '');
        if (leftValue === rightValue) {
          return 0;
        }
        return direction === 'asc'
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue);
      });
    }

    const result = input?.limit ? records.slice(0, input.limit) : records;
    return result.map((record) => ({ ...record }));
  }

  public async findManyByValues<TKey extends keyof TRecord>(input: {
    field: TKey;
    values: Array<NonNullable<TRecord[TKey]>>;
    limit?: number;
  }): Promise<TRecord[]> {
    await this.ensureSeeded();
    const valueSet = new Set(input.values);
    const records = this.records.filter((record) =>
      valueSet.has((record as Record<string, unknown>)[String(input.field)] as NonNullable<TRecord[TKey]>),
    );
    const result = input.limit ? records.slice(0, input.limit) : records;
    return result.map((record) => ({ ...record }));
  }

  public async insert(input: { record: TRecord }): Promise<void> {
    await this.ensureSeeded();
    this.records.push({ ...input.record });
  }

  public async update(input: { where: Partial<TRecord>; patch: Partial<TRecord> }): Promise<void> {
    await this.ensureSeeded();
    const record = this.records.find((current) => matchesWhere(current, input.where));
    if (!record) {
      throw new AppError('NOT_FOUND', 'Record not found', 404, input.where);
    }

    Object.assign(record, input.patch);
  }

  public async delete(input: { where: Partial<TRecord> }): Promise<void> {
    await this.ensureSeeded();
    const filtered = this.records.filter((record) => !matchesWhere(record, input.where));
    this.records.length = 0;
    this.records.push(...filtered);
  }
}

class DocumentRuntimeMemory implements IDocumentRuntime {
  private readonly records = new Map<string, MdmDocumentRecord>();
  private seeded = false;

  public constructor(private readonly seedLoader?: () => Promise<MdmDocumentRecord[]>) {}

  private async ensureSeeded(): Promise<void> {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    const rows = this.seedLoader ? await this.seedLoader() : [];
    for (const row of rows) {
      this.records.set(row.mdmId, { ...row, details: { ...row.details } });
    }
  }

  public async get(input: { mdmId: string }): Promise<MdmDocumentRecord | null> {
    await this.ensureSeeded();
    const record = this.records.get(input.mdmId);
    return record ? { ...record } : null;
  }

  public async getMany(input: { mdmIds: string[] }): Promise<MdmDocumentRecord[]> {
    await this.ensureSeeded();
    return input.mdmIds
      .map((mdmId) => this.records.get(mdmId))
      .filter((record): record is MdmDocumentRecord => record !== undefined)
      .map((record) => ({ ...record }));
  }

  public async put(input: {
    record: MdmDocumentInput;
    expectedVersion?: number | null;
  }): Promise<void> {
    await this.ensureSeeded();
    // Mechanically sync details.mdmId from the record id (single source of truth) so callers may omit it.
    const record: MdmDocumentRecord = { ...input.record, details: { ...input.record.details, mdmId: input.record.mdmId } as MdmDocumentRecord['details'] };
    const currentRecord = this.records.get(record.mdmId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      if (!currentRecord || currentRecord.version !== input.expectedVersion) {
        throw new AppError('CONCURRENCY_CONFLICT', 'Version mismatch', 409, {
          expectedVersion: input.expectedVersion,
          currentVersion: currentRecord?.version ?? null,
        });
      }
    }

    if (currentRecord && input.expectedVersion === undefined) {
      throw new AppError('DOCUMENT_EXISTS', 'Document already exists', 409, {
        mdmId: record.mdmId,
      });
    }

    this.records.set(record.mdmId, record);
  }

  public async delete(input: { mdmId: string }): Promise<void> {
    await this.ensureSeeded();
    this.records.delete(input.mdmId);
  }
}

class QueueRuntimeMemory implements IQueueRuntime {
  private readonly records: Array<{ topic: string; payload: unknown }> = [];

  public async publish(input: { topic: string; payload: unknown }): Promise<void> {
    this.records.push({ ...input });
  }

  public async list(input?: { topic?: string }): Promise<Array<{ topic: string; payload: unknown }>> {
    return input?.topic
      ? this.records.filter((record) => record.topic === input.topic)
      : [...this.records];
  }
}

export function createMemoryDataRuntime(): IDataRuntime {
  const env = readAppEnv();
  const runtime: IDataRuntime = {
    mode: 'memory',
    mdmDocument: new DocumentRuntimeMemory(() => loadSeedRows<MdmDocumentRecord>(env, 'mdmDocumentCache')),
    mdmEntityIndex: new TableRuntimeMemory<MdmEntityIndexRecord>(() => loadSeedRows<MdmEntityIndexRecord>(env, 'mdmEntityIndex')),
    mdmProspectIndex: new TableRuntimeMemory<MdmProspectIndexRecord>(),
    mdmRelationship: new TableRuntimeMemory<MdmRelationshipRecord>(() => loadSeedRows<MdmRelationshipRecord>(env, 'mdmRelationship')),
    mdmProspectRelationship: new TableRuntimeMemory<MdmRelationshipRecord>(),
    mdmAuditLog: new TableRuntimeMemory<MdmAuditLogIndexRecord>(),
    mdmComment: new TableRuntimeMemory<MdmCommentRecord>(),
    mdmAttachment: new TableRuntimeMemory<MdmAttachmentRecord>(),
    mdmNumberSequence: new TableRuntimeMemory<MdmNumberSequenceRecord>(),
    mdmMonitoringWrite: new TableRuntimeMemory<MdmMonitoringWriteRecord>(),
    mdmErrorLog: new TableRuntimeMemory<MdmErrorLogRecord>(),
    mdmStatusHistory: new TableRuntimeMemory<MdmStatusHistoryRecord>(),
    mdmTag: new TableRuntimeMemory<MdmTagRecord>(),
    mdmOutbox: new TableRuntimeMemory<MdmOutboxRecord>(),
    pgQueue: new QueueRuntimeMemory(),
    moduleData: createMemoryModuleDataRuntime(env),
    async runInTransaction<TValue>(callback: (data: IDataRuntime) => Promise<TValue>) {
      return callback(runtime);
    },
  };

  return runtime;
}
