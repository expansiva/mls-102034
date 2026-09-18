/// <mls fileReference="_102034_/l1/server/layer_2_application/schedule/evaluateSchedule.ts" enhancement="_blank" />
/**
 * Reads the `schedule` a workflow declares in prose and answers ONE question: is an occurrence due
 * right now, and which one?
 *
 * The l4 of a module writes `trigger.schedule` as free prose ("todo mes", "every day", "a cada 15
 * minutos"). The platform owns no calendar and no job table: the minute tick (`moduleTick.ts`) calls
 * the module, and the module asks this helper whether the moment it was handed is an occurrence it
 * still owes. `lastRun` is what the module itself recorded in its own `tdm` table, so the same
 * occurrence never fires twice.
 *
 * Pure: no clock of its own, no storage, no i/o. Prose it does not recognise returns `null` — and
 * says so on the console, because a schedule nobody understood must not look like a schedule nobody
 * owed.
 *
 * Time is read in the process timezone, the same one the tick runs in. Nothing here is specific to a
 * country: only the two prose languages the `workflows50` prompt produces, pt-BR and en.
 */

/** Occurrence forms the prose may name. */
type ParsedSchedule =
  | { kind: 'minutes'; minutes: number }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekday: number }
  | { kind: 'monthly'; dayOfMonth: number };

const MINUTE_MS = 60_000;

/** Accents folded the same way `workflows50/contracts.ts` folds them, so "mes" matches "mês". */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const WEEKDAYS: ReadonlyArray<readonly [number, RegExp]> = [
  [0, /\b(?:domingo|sunday)\b/u],
  [1, /\b(?:segunda(?:-feira)?|monday)\b/u],
  [2, /\b(?:terca(?:-feira)?|tuesday)\b/u],
  [3, /\b(?:quarta(?:-feira)?|wednesday)\b/u],
  [4, /\b(?:quinta(?:-feira)?|thursday)\b/u],
  [5, /\b(?:sexta(?:-feira)?|friday)\b/u],
  [6, /\b(?:sabado|saturday)\b/u],
];

const EVERY_N_MINUTES = /\b(?:a cada|every)\s+(\d{1,4})\s*(?:minutos?|minutes?|min)\b/u;
const WEEKLY = /\b(?:toda(?:s)?(?: as)? semanas?|every week|weekly|semanalmente)\b/u;
const MONTHLY = /\b(?:todo(?:s)?(?: os)? (?:mes|meses)|every month|monthly|mensalmente)\b/u;
const DAY_OF_MONTH = /\b(?:dia|day)\s+(\d{1,2})\b/u;
const DAILY = /\b(?:todo(?:s)?(?: os)? dias?|every day|daily|diariamente)\b/u;

/**
 * Prose to occurrence form. Order matters: "todo dia 5" is monthly on the 5th, not daily, so the
 * explicit day of the month is read before the daily form.
 */
function parseSchedule(schedule: string): ParsedSchedule | null {
  const text = foldAccents(schedule).replace(/\s+/gu, ' ').trim();
  if (!text) {
    return null;
  }

  const minutes = EVERY_N_MINUTES.exec(text);
  if (minutes) {
    const value = Number(minutes[1]);
    return value >= 1 ? { kind: 'minutes', minutes: value } : null;
  }

  if (WEEKLY.test(text)) {
    const named = WEEKDAYS.find(([, pattern]) => pattern.test(text));
    return { kind: 'weekly', weekday: named ? named[0] : 1 };
  }

  const dayOfMonth = DAY_OF_MONTH.exec(text);
  if (MONTHLY.test(text)) {
    const day = dayOfMonth ? Number(dayOfMonth[1]) : 1;
    return day >= 1 && day <= 31 ? { kind: 'monthly', dayOfMonth: day } : null;
  }
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    return day >= 1 && day <= 31 ? { kind: 'monthly', dayOfMonth: day } : null;
  }

  if (DAILY.test(text)) {
    return { kind: 'daily' };
  }

  return null;
}

function startOfDay(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** The latest occurrence of this form at or before `now`. */
function lastOccurrenceAt(parsed: ParsedSchedule, now: Date): Date {
  if (parsed.kind === 'minutes') {
    const step = parsed.minutes * MINUTE_MS;
    return new Date(Math.floor(now.getTime() / step) * step);
  }
  if (parsed.kind === 'daily') {
    return startOfDay(now);
  }
  if (parsed.kind === 'weekly') {
    const today = startOfDay(now);
    const back = (today.getDay() - parsed.weekday + 7) % 7;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  }

  const dayThisMonth = Math.min(parsed.dayOfMonth, daysInMonth(now.getFullYear(), now.getMonth()));
  if (now.getDate() >= dayThisMonth) {
    return new Date(now.getFullYear(), now.getMonth(), dayThisMonth);
  }
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const dayPreviousMonth = Math.min(
    parsed.dayOfMonth,
    daysInMonth(previous.getFullYear(), previous.getMonth()),
  );
  return new Date(previous.getFullYear(), previous.getMonth(), dayPreviousMonth);
}

/**
 * The occurrence this schedule owes at `now`, or `null` when it owes nothing.
 *
 * @param schedule prose written by the l4 of the module (`trigger.schedule`).
 * @param now the instant the tick handed the module.
 * @param lastRun when the module last ran this schedule, or `null` if it never did.
 * @returns the occurrence timestamp (≤ `now`) still owed, or `null` when the prose is not a schedule
 *          or the occurrence has already run.
 */
export function evaluateSchedule(schedule: string, now: Date, lastRun: Date | null): Date | null {
  const parsed = parseSchedule(schedule);
  if (!parsed) {
    console.warn(`[schedule] not a recognised schedule, nothing will fire: ${JSON.stringify(schedule)}`);
    return null;
  }

  const occurrence = lastOccurrenceAt(parsed, now);
  if (lastRun && lastRun.getTime() >= occurrence.getTime()) {
    return null;
  }
  return occurrence;
}
