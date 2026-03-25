/// <mls fileReference="_102034_/l1/mdm/layer_3_usecases/core/mdmEntityDefs.ts" enhancement="_blank" />
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import { buildEntityIndex, buildProspectIndex, toDocumentRecord } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import type {
  EntityDef,
  MdmDetailRecord,
  MdmEntityIndexRecord,
  MdmProspectIndexRecord,
} from '/_102034_/l1/mdm/module.js';

function getAuditSnapshot(detail: MdmDetailRecord, index: MdmEntityIndexRecord | MdmProspectIndexRecord) {
  return {
    index,
    details: detail,
  };
}

export const mdmEntityDef: EntityDef<MdmDetailRecord, MdmEntityIndexRecord> = {
  entityType: 'MdmEntity',
  moduleName: 'mdm',
  getIndexRuntime(runtime: IDataRuntime) {
    return runtime.mdmEntityIndex;
  },
  buildIndex(detail) {
    return buildEntityIndex(detail);
  },
  toDocument(detail, version) {
    return toDocumentRecord(detail, version);
  },
  getId(detail) {
    return detail.mdmId;
  },
  getAuditSnapshot(detail, index) {
    return getAuditSnapshot(detail, index);
  },
};

export const mdmProspectDef: EntityDef<MdmDetailRecord, MdmProspectIndexRecord> = {
  entityType: 'MdmProspect',
  moduleName: 'mdm',
  getIndexRuntime(runtime: IDataRuntime) {
    return runtime.mdmProspectIndex;
  },
  buildIndex(detail) {
    return buildProspectIndex(detail);
  },
  toDocument(detail, version) {
    return toDocumentRecord(detail, version);
  },
  getId(detail) {
    return detail.mdmId;
  },
  getAuditSnapshot(detail, index) {
    return getAuditSnapshot(detail, index);
  },
};
