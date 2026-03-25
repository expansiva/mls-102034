/// <mls fileReference="_102034_/l1/mdm/tableNames.ts" enhancement="_blank" />
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';

export function getMdmTableNames(appEnv: AppEnv['appEnv']) {
  const testSuffix = appEnv === 'staging' ? '_test' : '';

  return {
    documents: `mdm_documents${testSuffix}`,
    documentsEntitiesIndex: `mdm_documents_entities_index${testSuffix}`,
    documentsProspectsIndex: `mdm_documents_prospects_index${testSuffix}`,
    kv: `mdm_kv${testSuffix}`,
    relationship: `mdm_relationship${testSuffix}`,
    prospectRelationship: `mdm_prospect_relationship${testSuffix}`,
    auditLog: `mdm_audit_log${testSuffix}`,
    tag: `mdm_tag${testSuffix}`,
    comment: `mdm_comment${testSuffix}`,
    attachment: `mdm_attachment${testSuffix}`,
    numberSequence: `mdm_number_sequence${testSuffix}`,
    outbox: `mdm_outbox${testSuffix}`,
    replicationFailures: `mdm_replication_failures${testSuffix}`,
    monitoringWrite: `mdm_monitoring_write${testSuffix}`,
    errorLog: `mdm_error_log${testSuffix}`,
    statusHistory: `mdm_status_history${testSuffix}`,
  };
}
