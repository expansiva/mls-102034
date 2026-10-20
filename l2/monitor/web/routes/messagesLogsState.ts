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

const defaultQuery = (): MessagesLogsQuery => ({
  app: 'msg',
  stream: 'error',
  startAt: '',
  text: '',
});

export function createMessagesLogsState(): MessagesLogsState {
  return {
    generation: 0,
    mounted: false,
    phase: 'loading',
    query: defaultQuery(),
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

/** datetime-local value is a UTC wall clock. Empty means no time filter. */
export function startAtLocalToIso(value: string): { ok: true; iso: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, iso: '' };
  const match = LOCAL_DATE_TIME.exec(trimmed);
  if (!match) return { ok: false, error: 'Enter a valid UTC date and time.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, error: 'Enter a valid UTC date and time.' };
  }
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    return { ok: false, error: 'Enter a valid UTC date and time.' };
  }
  const iso = utc.toISOString().replace('.000Z', 'Z');
  return { ok: true, iso };
}

/** One displayed line block: the UTC timestamp (when the source had one) and the message. Copy uses the same text. */
export function messagesLogsEntryLine(entry: MonitorLogEntry): string {
  return entry.timestamp ? `${entry.timestamp} ${entry.text}` : entry.text;
}

export function messagesLogsBody(state: MessagesLogsState): string {
  return state.entries.map(messagesLogsEntryLine).join('\n');
}

export function messagesLogsCopyText(state: MessagesLogsState): string {
  if (state.phase === 'loading' || state.entries.length === 0) return '';
  const process = state.query.app === 'msg' ? 'API' : 'Worker';
  const output = state.query.stream === 'out' ? 'Standard output' : 'Error output';
  const lines = [`Process: ${process}`, `Output: ${output}`];
  if (state.query.startAt) lines.push(`Start at (UTC): ${state.query.startAt}`);
  if (state.query.text) lines.push(`Message contains: ${state.query.text}`);
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
