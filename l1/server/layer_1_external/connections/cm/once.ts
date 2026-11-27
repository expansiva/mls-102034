/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/once.ts" enhancement="_blank" />
/**
 * `once(ctx, { scope, key }, work)`: runs `work` once per (module, scope, key); a repeat gets the stored answer and `work` does not run.
 * The module is the one the platform is running (`callerModuleOf`), never one the code names. It has to be called inside a transaction
 * (`serveCm`, or `runInTransaction` of the module): the answer is written in the SAME transaction as what `work` wrote, so a rollback
 * keeps neither, and a repeat runs again. An exception is never stored.
 */
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { callerModuleOf } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { ONCE_ANSWER_TABLE } from '/_102034_/l1/server/layer_1_external/connections/cm/onceStore.js';
import { platformTransactionAccess } from '/_102034_/l1/server/layer_1_external/data/postgres/txClient.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/**
 * The shapes JSON can carry, as a constraint a type satisfies BY STRUCTURE: an `interface` of the catalog (no index signature) fits,
 * a function or a `Date` in the type does not. `undefined` is allowed as a value because an optional field is `T | undefined`.
 */
export type Jsonable<T> = T extends string | number | boolean | null | undefined ? T
  : T extends readonly (infer U)[] ? readonly Jsonable<U>[]
  : T extends (...args: never[]) => unknown ? never
  : T extends object ? { [K in keyof T]: Jsonable<T[K]> }
  : never;

/**
 * The value has to survive the trip through JSON as itself: nothing is stored that comes back different. A key with `undefined` is the
 * same as an absent key (JSON leaves it out); anything else that JSON changes or drops is refused, with the path of the first bad value.
 */
function assertJson(value: unknown, at: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw notJson(at, 'a number that is not finite');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item === undefined) throw notJson(`${at}[${index}]`, 'undefined in a list');
      assertJson(item, `${at}[${index}]`);
    });
    return;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw notJson(at, `an instance of ${(value as object).constructor?.name ?? 'a class'}`);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue;
      assertJson(child, `${at}.${key}`);
    }
    return;
  }
  throw notJson(at, typeof value === 'undefined' ? 'undefined' : `a ${typeof value}`);
}

function notJson(at: string, what: string): AppError {
  return new AppError('ONCE_ANSWER_NOT_JSON', `The answer kept by once has to be JSON: ${at} is ${what}.`, 500, { path: at });
}

const memory = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

/** Test helper: forgets the answers kept in memory (no Postgres). */
export function resetOnceMemory(): void {
  memory.clear();
  inFlight.clear();
}

/** What is kept and what a repeat gets: the value after the trip through JSON, the same on the first run and on every repeat. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function once<T>(
  ctx: RequestContext,
  where: { scope: string; key: string },
  // `T & Jsonable<T>`: an answer that is not JSON-shaped (a function, a Date) does not fit, and there is no circular constraint on T.
  work: () => Promise<T & Jsonable<T>>,
): Promise<T> {
  const moduleId = callerModuleOf();
  if (moduleId === undefined) throw new Error('[once] needs a running module: call it from a route of the module');
  if (typeof where?.scope !== 'string' || where.scope === '' || typeof where.key !== 'string' || where.key === '') {
    throw new Error('[once] scope and key are required');
  }
  const access = platformTransactionAccess(ctx.data.moduleData);
  if (access?.inTransaction !== true) throw new Error('[once] has to run inside a transaction (serveCm or runInTransaction)');

  const sql = access.sql;
  if (sql === undefined) {
    const id = `${moduleId}\0${where.scope}\0${where.key}`;
    if (memory.has(id)) return clone(memory.get(id) as T);
    const running = inFlight.get(id);
    if (running) {
      try {
        return clone((await running) as T);
      } catch {
        // The first one failed and stored nothing: this one runs.
      }
      if (memory.has(id)) return clone(memory.get(id) as T);
    }
    const attempt = work().then((answer) => {
      assertJson(answer, 'answer');
      memory.set(id, clone(answer));
      return answer as unknown;
    });
    inFlight.set(id, attempt);
    try {
      return clone((await attempt) as T);
    } finally {
      if (inFlight.get(id) === attempt) inFlight.delete(id);
    }
  }

  // Same (module, scope, key) in two transactions: the second waits here for the commit of the first, then reads its answer.
  await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [JSON.stringify(['once', moduleId, where.scope, where.key])]);
  const found = await sql.query(
    `SELECT "answer" FROM "${ONCE_ANSWER_TABLE}" WHERE "module" = $1 AND "scope" = $2 AND "key" = $3`,
    [moduleId, where.scope, where.key],
  );
  if (found.rows.length > 0) return found.rows[0].answer as T;
  const answer = await work();
  assertJson(answer, 'answer');
  await sql.query(
    `INSERT INTO "${ONCE_ANSWER_TABLE}" ("module", "scope", "key", "answer", "createdAt") VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz) ON CONFLICT ("module", "scope", "key") DO NOTHING`,
    [moduleId, where.scope, where.key, JSON.stringify(answer), new Date().toISOString()],
  );
  return clone(answer);
}
