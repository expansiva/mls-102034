/// <mls fileReference="_102034_/l1/audit/module.ts" enhancement="_blank" />
export interface AuditNamedCount {
  label: string;
  count: number;
}

export interface AuditLogEventRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  actorType: string;
  module: string;
  routine: string;
  createdAt: string;
  hasRemoteDiff: boolean;
}

export interface AuditStatusEventRecord {
  id: string;
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  reasonCode?: string | null;
  actorId: string;
  actorType: string;
  module: string;
  routine: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditHomeResponse {
  generatedAt: string;
  system: {
    appEnv: string;
    runtimeMode: 'memory' | 'postgres';
    writeBehindEnabled: boolean;
    awsRegion: string;
  };
  summary: {
    auditLog: {
      total: number;
      last24h: number;
      uniqueModules: number;
      uniqueActors: number;
    };
    statusHistory: {
      total: number;
      last24h: number;
      uniqueEntities: number;
      uniqueTransitions: number;
    };
  };
  explanation: {
    auditLog: string;
    statusHistory: string;
  };
  distribution: {
    byModule: AuditNamedCount[];
    byEntityType: AuditNamedCount[];
    byActorId: AuditNamedCount[];
  };
  recentEvents: {
    auditLog: AuditLogEventRecord[];
    statusHistory: AuditStatusEventRecord[];
  };
}

export interface AuditLogLoadParams {
  module?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogDetailsParams {
  id: string;
}

export interface AuditLogDetailsResponse {
  generatedAt: string;
  event: (AuditLogEventRecord & {
    diff: unknown[] | null;
  }) | null;
}

export interface AuditLogResponse {
  generatedAt: string;
  filters: Required<AuditLogLoadParams>;
  summary: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    uniqueModules: number;
    uniqueActors: number;
    createCount: number;
    updateCount: number;
    deleteCount: number;
    restoreCount: number;
  };
  groups: {
    byModule: AuditNamedCount[];
    byRoutine: AuditNamedCount[];
    byActorId: AuditNamedCount[];
    byAction: AuditNamedCount[];
  };
  events: AuditLogEventRecord[];
}

export interface AuditStatusHistoryLoadParams {
  module?: string;
  entityType?: string;
  entityId?: string;
  fromStatus?: string;
  toStatus?: string;
  actorId?: string;
  reasonCode?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditStatusHistoryResponse {
  generatedAt: string;
  filters: Required<AuditStatusHistoryLoadParams>;
  summary: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    uniqueModules: number;
    uniqueEntities: number;
    uniqueTransitions: number;
  };
  groups: {
    byModule: AuditNamedCount[];
    byEntityType: AuditNamedCount[];
    byTransition: AuditNamedCount[];
    currentStatuses: AuditNamedCount[];
  };
  events: AuditStatusEventRecord[];
}
