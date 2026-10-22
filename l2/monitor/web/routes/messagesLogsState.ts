/// <mls fileReference="_102034_/l2/monitor/web/routes/messagesLogsState.ts" enhancement="_blank" />
import type { MonitorLogApp, MonitorLogEntry, MonitorLogPage, MonitorLogStream } from '/_102034_/l2/monitor/shared/contracts/logs.js';

export type MessagesLogsPhase =
  | 'loading'
  | 'loading-more'
  | 'error'
  | 'empty'
  | 'limited'
  | 'source-changed'
  | 'result';

export interface MessagesLogsQuery {
  app: MonitorLogApp;
  stream: MonitorLogStream;
  /** ISO UTC with an explicit zone, or empty when the time filter is off. */
  startAt: string;
  text: string;
}

export interface MessagesLogsState {
  generation: number;
  mounted: boolean;
  phase: MessagesLogsPhase;
  query: MessagesLogsQuery;
  entries: MonitorLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  limited: boolean;
  file: string;
  errorMessage: string;
  pendingCursor: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** Start at fixed when a screen is created: one hour before `now`, whole seconds, ISO UTC. */
export function messagesLogsInitialStartAt(now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000) * 1000;
  return new Date(seconds - HOUR_MS).toISOString().replace('.000Z', 'Z');
}

const defaultQuery = (now: Date): MessagesLogsQuery => ({
  app: 'msg',
  stream: 'out',
  startAt: messagesLogsInitialStartAt(now),
  text: '',
});

export function createMessagesLogsState(now: Date = new Date()): MessagesLogsState {
  return {
    generation: 0,
    mounted: false,
    phase: 'loading',
    query: defaultQuery(now),
    entries: [],
    nextCursor: null,
    hasMore: false,
    limited: false,
    file: '',
    errorMessage: '',
    pendingCursor: null,
  };
}

/** New mount. In-flight responses from the previous mount no longer match. */
export function connectMessagesLogs(state: MessagesLogsState): MessagesLogsState {
  return {
    ...createMessagesLogsState(),
    generation: state.generation + 1,
    mounted: true,
    query: state.query,
  };
}

export function disconnectMessagesLogs(state: MessagesLogsState): MessagesLogsState {
  return {
    ...state,
    mounted: false,
    generation: state.generation + 1,
    pendingCursor: null,
  };
}

export function isCurrentMessagesLogs(state: MessagesLogsState, generation: number): boolean {
  return state.mounted && state.generation === generation;
}

export function beginMessagesLogsQuery(state: MessagesLogsState, query: MessagesLogsQuery): MessagesLogsState {
  return {
    ...state,
    generation: state.generation + 1,
    phase: 'loading',
    query,
    entries: [],
    nextCursor: null,
    hasMore: false,
    limited: false,
    file: '',
    errorMessage: '',
    pendingCursor: null,
  };
}

function phaseFor(entries: MonitorLogEntry[], hasMore: boolean, limited: boolean): MessagesLogsPhase {
  if (limited) return 'limited';
  if (entries.length === 0) return 'empty';
  if (!hasMore) return 'result';
  return 'result';
}

export function applyMessagesLogsPage(
  state: MessagesLogsState,
  generation: number,
  page: MonitorLogPage,
): MessagesLogsState {
  if (!isCurrentMessagesLogs(state, generation) || state.phase !== 'loading') return state;
  return {
    ...state,
    phase: phaseFor(page.entries, page.hasMore, page.limited),
    entries: page.entries,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    limited: page.limited,
    file: page.file,
    errorMessage: '',
    pendingCursor: null,
  };
}

export function failMessagesLogsQuery(
  state: MessagesLogsState,
  generation: number,
  message: string,
): MessagesLogsState {
  if (!isCurrentMessagesLogs(state, generation) || state.phase !== 'loading') return state;
  return {
    ...state,
    phase: 'error',
    entries: [],
    nextCursor: null,
    hasMore: false,
    limited: false,
    file: '',
    errorMessage: message,
    pendingCursor: null,
  };
}

export function markMessagesLogsSourceChanged(
  state: MessagesLogsState,
  generation: number,
): MessagesLogsState {
  if (!isCurrentMessagesLogs(state, generation)) return state;
  if (state.phase !== 'loading' && state.phase !== 'loading-more') return state;
  return {
    ...state,
    phase: 'source-changed',
    entries: [],
    nextCursor: null,
    hasMore: false,
    limited: false,
    errorMessage: 'Log source changed. Refresh to load the current file.',
    pendingCursor: null,
  };
}

export function beginMessagesLogsLoadMore(state: MessagesLogsState): MessagesLogsState {
  if (!state.mounted || !state.hasMore || !state.nextCursor || state.pendingCursor) return state;
  if (state.phase === 'loading' || state.phase === 'loading-more' || state.phase === 'source-changed') return state;
  return {
    ...state,
    phase: 'loading-more',
    pendingCursor: state.nextCursor,
    errorMessage: '',
  };
}

export function applyMessagesLogsOlderPage(
  state: MessagesLogsState,
  generation: number,
  requestedCursor: string,
  page: MonitorLogPage,
): MessagesLogsState {
  if (!isCurrentMessagesLogs(state, generation)) return state;
  if (state.phase !== 'loading-more' || state.pendingCursor !== requestedCursor) return state;
  const seen = new Set(state.entries.map((entry) => entry.id));
  const older = page.entries.filter((entry) => !seen.has(entry.id));
  const entries = [...older, ...state.entries];
  return {
    ...state,
    phase: phaseFor(entries, page.hasMore, page.limited),
    entries,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    limited: page.limited,
    file: page.file || state.file,
    errorMessage: '',
    pendingCursor: null,
  };
}

export function failMessagesLogsLoadMore(
  state: MessagesLogsState,
  generation: number,
  message: string,
): MessagesLogsState {
  if (!isCurrentMessagesLogs(state, generation)) return state;
  if (state.phase !== 'loading-more') return state;
  const entries = state.entries;
  return {
    ...state,
    phase: entries.length === 0 ? 'error' : (state.limited ? 'limited' : 'result'),
    errorMessage: message,
    pendingCursor: null,
  };
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE_TIME_ERROR = 'Enter a valid local date and time.';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** datetime-local components are the browser's local wall clock. Empty means no time filter. */
export function startAtLocalToIso(value: string): { ok: true; iso: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, iso: '' };
  const match = LOCAL_DATE_TIME.exec(trimmed);
  if (!match) return { ok: false, error: LOCAL_DATE_TIME_ERROR };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, error: LOCAL_DATE_TIME_ERROR };
  }
  // One local interpretation. Date folds a DST gap forward; that mismatch is a rejection.
  const local = new Date(year, month - 1, day, hour, minute, second);
  if (
    Number.isNaN(local.getTime())
    || local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
    || local.getSeconds() !== second
  ) {
    return { ok: false, error: LOCAL_DATE_TIME_ERROR };
  }
  const iso = local.toISOString().replace('.000Z', 'Z');
  return { ok: true, iso };
}

/** `YYYY-MM-DDTHH:mm:ss` in the browser's local zone, for a datetime-local field. */
export function startAtIsoToLocal(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Zone name and the offset of this instant. Empty when `iso` is not a time. */
export function messagesLogsStartAtContext(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minutesEast = -date.getTimezoneOffset();
  const sign = minutesEast >= 0 ? '+' : '-';
  const abs = Math.abs(minutesEast);
  return `${zone} UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** One displayed line block: the UTC timestamp (when the source had one) and the message. Copy uses the same text. */
export function messagesLogsEntryLine(entry: MonitorLogEntry): string {
  return entry.timestamp ? `${entry.timestamp} ${entry.text}` : entry.text;
}

export function messagesLogsBody(state: MessagesLogsState): string {
  return state.entries.map(messagesLogsEntryLine).join('\n');
}

export const messagesLogsCopyLabelsEn = {
  processApi: 'API',
  processWorker: 'Worker',
  outputStandard: 'Standard output',
  outputError: 'Error output',
  startAtLocal: 'Start at',
  startAtUtc: 'Start at (UTC)',
  messageContains: 'Message contains',
} as const;

export type MessagesLogsCopyLabels = { [K in keyof typeof messagesLogsCopyLabelsEn]: string };

export function messagesLogsCopyText(
  state: MessagesLogsState,
  labels: MessagesLogsCopyLabels = messagesLogsCopyLabelsEn,
): string {
  if (state.phase === 'loading' || state.entries.length === 0) return '';
  const process = state.query.app === 'msg' ? labels.processApi : labels.processWorker;
  const output = state.query.stream === 'out' ? labels.outputStandard : labels.outputError;
  const lines = [`Process: ${process}`, `Output: ${output}`];
  if (state.query.startAt) {
    const local = startAtIsoToLocal(state.query.startAt);
    const context = messagesLogsStartAtContext(state.query.startAt);
    if (local && context) lines.push(`${labels.startAtLocal}: ${local} (${context})`);
    lines.push(`${labels.startAtUtc}: ${state.query.startAt}`);
  }
  if (state.query.text) lines.push(`${labels.messageContains}: ${state.query.text}`);
  const body = messagesLogsBody(state);
  return `${lines.join('\n')}\n\n${body}`;
}

export function messagesLogsCanCopy(state: MessagesLogsState): boolean {
  return messagesLogsCopyText(state).length > 0;
}

export function messagesLogsCanLoadMore(state: MessagesLogsState): boolean {
  return state.mounted
    && state.phase !== 'loading'
    && state.phase !== 'loading-more'
    && state.phase !== 'source-changed'
    && state.hasMore
    && !!state.nextCursor
    && !state.pendingCursor;
}
