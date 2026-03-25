/// <mls fileReference="_102034_/l2/monitor/shared/contracts/postgres.ts" enhancement="_blank" />
export interface MonitorPostgresResponse {
  generatedAt: string;
  postgres: {
    runtimeMode: 'memory' | 'postgres';
    connection: {
      host: string;
      port: number;
      currentDatabase: string;
      availableDatabases: string[];
    };
    database: {
      name: string;
      activeConnections: number;
      waitingLocks: number;
      cacheHitRate: number | null;
      commitCount: number;
      rollbackCount: number;
      deadlockCount: number;
    };
    queue: {
      pendingOutbox: number;
      processedOutbox: number;
      replicationFailures: number;
      cacheEntries: number;
    };
    tables: Array<{
      tableName: string;
      description?: string | null;
      moduleId?: string | null;
      repositoryName?: string | null;
      storageProfile?: string | null;
      backupHot?: boolean;
      exists: boolean;
      rowCount: number | null;
      totalSizeBytes: number | null;
    }>;
  };
}
