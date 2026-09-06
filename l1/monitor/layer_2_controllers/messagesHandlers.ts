/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/messagesHandlers.ts" enhancement="_blank" />
import { ok, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  loadMessagesStatus,
  type MessagesStatusDeps,
} from '/_102034_/l1/monitor/layer_3_usecases/messagesStatusUsecases.js';

export function createMessagesStatusHandler(deps: MessagesStatusDeps = {}): BffHandler {
  return async () => ok(await loadMessagesStatus(deps));
}

export const monitorMessagesStatusHandler: BffHandler = createMessagesStatusHandler();
