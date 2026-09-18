/// <mls fileReference="_102034_/l1/server/layer_2_application/schedule/evaluateSchedule.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSchedule } from '/_102034_/l1/server/layer_2_application/schedule/evaluateSchedule.js';

/** Local time, the same frame the helper reads. */
function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

test('every N minutes fires on the window boundary and not twice in the same window', () => {
  const now = at(2026, 9, 17, 10, 47);
  const due = evaluateSchedule('a cada 15 minutos', now, null);
  assert.deepEqual(due, at(2026, 9, 17, 10, 45));
  assert.equal(evaluateSchedule('every 15 minutes', now, at(2026, 9, 17, 10, 45)), null);
  assert.deepEqual(evaluateSchedule('every 15 minutes', now, at(2026, 9, 17, 10, 44)), at(2026, 9, 17, 10, 45));
});

test('daily prose owes the occurrence of today, in both languages', () => {
  const now = at(2026, 9, 17, 6, 3);
  assert.deepEqual(evaluateSchedule('todo dia', now, null), at(2026, 9, 17));
  assert.deepEqual(evaluateSchedule('every day', now, null), at(2026, 9, 17));
  assert.deepEqual(evaluateSchedule('diariamente', now, null), at(2026, 9, 17));
  assert.equal(evaluateSchedule('todo dia', now, at(2026, 9, 17)), null);
  assert.deepEqual(evaluateSchedule('todo dia', now, at(2026, 9, 16, 23, 59)), at(2026, 9, 17));
});

test('weekly walks back to the named weekday, and defaults to monday', () => {
  // 2026-09-17 is a thursday.
  const now = at(2026, 9, 17, 9, 0);
  assert.deepEqual(evaluateSchedule('toda semana na segunda-feira', now, null), at(2026, 9, 14));
  assert.deepEqual(evaluateSchedule('every week on friday', now, null), at(2026, 9, 11));
  assert.deepEqual(evaluateSchedule('toda semana', now, null), at(2026, 9, 14));
  assert.deepEqual(evaluateSchedule('every week on thursday', now, null), at(2026, 9, 17));
});

test('monthly reads the day, falls back to the first, and never skips to next month', () => {
  assert.deepEqual(evaluateSchedule('todo mês no dia 5', at(2026, 9, 17), null), at(2026, 9, 5));
  assert.deepEqual(evaluateSchedule('todo mês no dia 25', at(2026, 9, 17), null), at(2026, 8, 25));
  assert.deepEqual(evaluateSchedule('every month', at(2026, 9, 17), null), at(2026, 9, 1));
  assert.deepEqual(evaluateSchedule('mensalmente', at(2026, 9, 17), null), at(2026, 9, 1));
  // "todo dia 5" is the fifth of the month, not every day.
  assert.deepEqual(evaluateSchedule('todo dia 5', at(2026, 9, 17), null), at(2026, 9, 5));
  assert.equal(evaluateSchedule('todo mês no dia 5', at(2026, 9, 17), at(2026, 9, 5)), null);
});

test('a day of the month that the month does not have is clamped to its last day', () => {
  assert.deepEqual(evaluateSchedule('todo mês no dia 31', at(2026, 2, 28), null), at(2026, 2, 28));
  assert.deepEqual(evaluateSchedule('todo mês no dia 31', at(2026, 3, 5), null), at(2026, 2, 28));
});

test('prose that is not a schedule owes nothing', () => {
  const now = at(2026, 9, 17, 10, 0);
  assert.equal(evaluateSchedule('quando um veículo passou do km previsto para a revisão', now, null), null);
  assert.equal(evaluateSchedule('when the order is approved', now, null), null);
  assert.equal(evaluateSchedule('', now, null), null);
  assert.equal(evaluateSchedule('a cada 0 minutos', now, null), null);
});
