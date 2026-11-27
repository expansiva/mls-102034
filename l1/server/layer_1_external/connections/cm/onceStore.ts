/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/onceStore.ts" enhancement="_blank" />
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

/** The answers `once` keeps. Unique on (module, scope, key). Rows older than 30 days are deleted by `onTick` of the platformOnce persistence. */
export const ONCE_ANSWER_TABLE = 'platform_once_answer';
/** The senders re-send for up to 7 days (WhatsApp), 24 h (Telegram). */
export const ONCE_ANSWER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const onceAnswerDefinition: TableDefinition = {
  moduleId: 'platformOnce',
  repositoryName: ONCE_ANSWER_TABLE,
  tableName: ONCE_ANSWER_TABLE,
  purpose: 'controle',
  description: 'Answers of `once`: the work done once per (module, scope, key). The module is read from the running module, never from the code of the module. Purged after 30 days by onTick.',
  backupHot: false,
  storageProfile: 'postgres',
  writeMode: 'sync',
  columns: [
    { name: 'module', postgresType: 'TEXT' },
    { name: 'scope', postgresType: 'TEXT' },
    { name: 'key', postgresType: 'TEXT' },
    { name: 'answer', postgresType: 'JSONB' },
    { name: 'createdAt', postgresType: 'TIMESTAMPTZ' },
  ],
  primaryKey: ['module', 'scope', 'key'],
  version: 1,
};
