/// <mls fileReference="_102034_/l1/mdm/layer_2_controllers/router.ts" enhancement="_blank" />
import type { BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  attachmentAttachHandler,
  attachmentDetachHandler,
  attachmentFindByEntityHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/attachmentHandlers.js';
import {
  commentAddHandler,
  commentEditHandler,
  commentFindByEntityHandler,
  commentRemoveHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/commentHandlers.js';
import {
  entityCreateHandler,
  entityGetHandler,
  entityListHandler,
  entityUpdateHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/entityHandlers.js';
import { numberSequenceNextHandler } from '/_102034_/l1/mdm/layer_2_controllers/numberSequenceHandlers.js';
import {
  prospectCreateHandler,
  prospectGetHandler,
  prospectListHandler,
  prospectPromoteToEntityHandler,
  prospectUpdateHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/prospectFacadeHandlers.js';
import {
  relationshipCreateHandler,
  relationshipListHandler,
  relationshipUpdateHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/relationshipHandlers.js';
import {
  tagAddHandler,
  tagFindByEntityHandler,
  tagFindByTagHandler,
  tagRemoveHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/tagHandlers.js';
import {
  statusHistoryFindByEntityHandler,
  statusHistoryFindLatestHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/statusHistoryHandlers.js';
import {
  kvGetHandler,
  kvPutHandler,
} from '/_102034_/l1/mdm/layer_2_controllers/kvHandlers.js';

export function createMdmRouter(): Map<string, BffHandler> {
  return new Map<string, BffHandler>([
    ['mdm.entity.create', entityCreateHandler],
    ['mdm.entity.get', entityGetHandler],
    ['mdm.entity.list', entityListHandler],
    ['mdm.entity.update', entityUpdateHandler],
    ['mdm.prospect.create', prospectCreateHandler],
    ['mdm.prospect.get', prospectGetHandler],
    ['mdm.prospect.list', prospectListHandler],
    ['mdm.prospect.update', prospectUpdateHandler],
    ['mdm.prospect.promoteToEntity', prospectPromoteToEntityHandler],
    ['mdm.comment.add', commentAddHandler],
    ['mdm.comment.edit', commentEditHandler],
    ['mdm.comment.remove', commentRemoveHandler],
    ['mdm.comment.findByEntity', commentFindByEntityHandler],
    ['mdm.attachment.attach', attachmentAttachHandler],
    ['mdm.attachment.detach', attachmentDetachHandler],
    ['mdm.attachment.findByEntity', attachmentFindByEntityHandler],
    ['mdm.numberSequence.next', numberSequenceNextHandler],
    ['mdm.relationship.create', relationshipCreateHandler],
    ['mdm.relationship.list', relationshipListHandler],
    ['mdm.relationship.update', relationshipUpdateHandler],
    ['mdm.tag.add', tagAddHandler],
    ['mdm.tag.remove', tagRemoveHandler],
    ['mdm.tag.findByEntity', tagFindByEntityHandler],
    ['mdm.tag.findByTag', tagFindByTagHandler],
    ['mdm.statusHistory.findByEntity', statusHistoryFindByEntityHandler],
    ['mdm.statusHistory.findLatest', statusHistoryFindLatestHandler],
    ['mdm.kv.get', kvGetHandler],
    ['mdm.kv.put', kvPutHandler],
  ]);
}
