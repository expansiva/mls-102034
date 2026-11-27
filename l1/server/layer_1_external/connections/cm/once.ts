/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/once.ts" enhancement="_blank" />
/**
 * `once(ctx, { scope, key }, work)`: runs `work` once per (module, scope, key); a repeat gets the stored answer and `work` does not run.
 * The module is the one the platform is running (`callerModuleOf`), never one the code names. It has to be called inside a transaction
 * (`serveCm`, or `runInTransaction` of the module): the answer is written in the SAME transaction as what `work` wrote, so a rollback
 * keeps neither, and a repeat runs again. An exception is never stored.
 */
import { callerModuleOf } from '/_102034_/l1/server/layer_1_external/connections/callerModule.js';
import { ONCE_ANSWER_TABLE } from '/_102034_/l1/server/layer_1_external/connections/cm/onceStore.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const memory = new Map<string, JsonValue>();
const inFlight = new Map<string, Promise<JsonValue>>();

/** Test helper: forgets the answers kept in memory (no Postgres). */
export function resetOnceMemory(): void {
  memory.clear();
  inFlight.clear();
}

function clone<T extends JsonValue>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export async function once<T extends JsonValue>(
  ctx: RequestContext,
  where: { scope: string; key: string },
  work: () => Promise<T>,
): Promise<T> {
  const moduleId = callerModuleOf();
  if (moduleId === undefined) throw new Error('[once] needs a running module: call it from a route of the module');
  if (typeof where?.scope !== 'string' || where.scope === '' || typeof where.key !== 'string' || where.key === '') {
    throw new Error('[once] scope and key are required');
  }
  const data = ctx.data.moduleData;
  if (data.inTransaction?.() !== true) throw new Error('[once] has to run inside a transaction (serveCm or runInTransaction)');

  const sql = data.transactionSql?.();
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
      if (answer === undefined) throw new Error('[once] work has to return a JSON value');
      memory.set(id, clone(answer));
      return answer as JsonValue;
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
  if (answer === undefined) throw new Error('[once] work has to return a JSON value');
  await sql.query(
    `INSERT INTO "${ONCE_ANSWER_TABLE}" ("module", "scope", "key", "answer", "createdAt") VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz) ON CONFLICT ("module", "scope", "key") DO NOTHING`,
    [moduleId, where.scope, where.key, JSON.stringify(answer), new Date().toISOString()],
  );
  return answer;
}
