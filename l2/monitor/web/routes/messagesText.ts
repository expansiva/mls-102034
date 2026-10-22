/// <mls fileReference="_102034_/l2/monitor/web/routes/messagesText.ts" enhancement="_blank" />
import { getMessageKey } from '/_102029_/l2/collabLitElement.js';
import type { MessagesLogsCopyLabels } from '/_102034_/l2/monitor/web/routes/messagesLogsState.js';

/** User-facing strings for the Collab Messages log panel. Default language is `en`. */
export interface MessagesPageText {
  startAt: string;
  startAtHelp: string;
  invalidStartAt: string;
  logSource: string;
  apiStandardOutput: string;
  apiErrorOutput: string;
  workerStandardOutput: string;
  workerErrorOutput: string;
  copied: string;
  copyFailed: string;
  processApi: string;
  processWorker: string;
  outputStandard: string;
  outputError: string;
  startAtUtc: string;
  messageContains: string;
}

const en: MessagesPageText = {
  startAt: 'Start at (local time)',
  startAtHelp: 'Browser time zone',
  invalidStartAt: 'Enter a valid local date and time.',
  logSource: 'Log source',
  apiStandardOutput: 'API · Standard output',
  apiErrorOutput: 'API · Error output',
  workerStandardOutput: 'Worker · Standard output',
  workerErrorOutput: 'Worker · Error output',
  copied: 'Copied',
  copyFailed: 'Copy failed (clipboard unavailable)',
  processApi: 'API',
  processWorker: 'Worker',
  outputStandard: 'Standard output',
  outputError: 'Error output',
  startAtUtc: 'Start at (UTC)',
  messageContains: 'Message contains',
};

const catalog: Record<string, MessagesPageText> = { en };

export function messagesPageText(): MessagesPageText {
  const key = getMessageKey(catalog);
  return catalog[key] ?? en;
}

export function messagesPageCopyLabels(text: MessagesPageText): MessagesLogsCopyLabels {
  return {
    processApi: text.processApi,
    processWorker: text.processWorker,
    outputStandard: text.outputStandard,
    outputError: text.outputError,
    startAtLocal: text.startAt,
    startAtUtc: text.startAtUtc,
    messageContains: text.messageContains,
  };
}
