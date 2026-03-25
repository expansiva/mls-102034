/// <mls fileReference="_102034_/l1/server/layer_1_external/config/storageConfig.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

type StorageConfig = {
  dynamoTableMdm: string;
  dynamoTableMdmRelationship: string;
  dynamoTableMdmProspectRelationship: string;
  dynamoTableMdmAuditLog: string;
  dynamoTableMdmTag: string;
  dynamoTableMdmComment: string;
  dynamoTableMdmAttachment: string;
  dynamoTableMdmNumberSequence: string;
};

const STORAGE_CONFIG_BY_ENV: Record<AppEnv['appEnv'], StorageConfig> = {
  development: {
    dynamoTableMdm: 'mdm_documents',
    dynamoTableMdmRelationship: 'mdm_relationship',
    dynamoTableMdmProspectRelationship: 'mdm_prospect_relationship',
    dynamoTableMdmAuditLog: 'mdm_audit_log',
    dynamoTableMdmTag: 'mdm_tag',
    dynamoTableMdmComment: 'mdm_comment',
    dynamoTableMdmAttachment: 'mdm_attachment',
    dynamoTableMdmNumberSequence: 'mdm_number_sequence',
  },
  staging: {
    dynamoTableMdm: 'mdm_documents_test',
    dynamoTableMdmRelationship: 'mdm_relationship_test',
    dynamoTableMdmProspectRelationship: 'mdm_prospect_relationship_test',
    dynamoTableMdmAuditLog: 'mdm_audit_log_test',
    dynamoTableMdmTag: 'mdm_tag_test',
    dynamoTableMdmComment: 'mdm_comment_test',
    dynamoTableMdmAttachment: 'mdm_attachment_test',
    dynamoTableMdmNumberSequence: 'mdm_number_sequence_test',
  },
  production: {
    dynamoTableMdm: 'mdm_documents',
    dynamoTableMdmRelationship: 'mdm_relationship',
    dynamoTableMdmProspectRelationship: 'mdm_prospect_relationship',
    dynamoTableMdmAuditLog: 'mdm_audit_log',
    dynamoTableMdmTag: 'mdm_tag',
    dynamoTableMdmComment: 'mdm_comment',
    dynamoTableMdmAttachment: 'mdm_attachment',
    dynamoTableMdmNumberSequence: 'mdm_number_sequence',
  },
};

export function getStorageConfig(appEnv: AppEnv['appEnv']): StorageConfig {
  return STORAGE_CONFIG_BY_ENV[appEnv];
}
