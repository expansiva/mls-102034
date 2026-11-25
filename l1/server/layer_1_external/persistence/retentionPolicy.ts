/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/retentionPolicy.ts" enhancement="_blank"/>
/**
 * `TableDefinition.retentionDays` made real: a hypertable that declares it gets the Timescale retention policy, and a table that
 * cannot have one fails the bootstrap by name, never silently (a plain table declares no column for "when the row was written").
 */
import type { Pool } from 'pg';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

type RetentionShape = Pick<ResolvedTableDefinition, 'tableName' | 'retentionDays' | 'timescale'>;

/** Why the declaration cannot be applied, or `undefined` when it can (or when the table keeps its rows: no `retentionDays`, or 0). */
export function retentionProblem(definition: RetentionShape): string | undefined {
  const days = definition.retentionDays;
  // 0 is how the generated definitions say "keep forever" (102046 declares it on 18 tables): the same as no declaration.
  if (days === undefined || days === 0) return undefined;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    return `retentionDays must be an integer of 1 or more: ${definition.tableName}`;
  }
  if (!definition.timescale?.hypertable) return `retentionDays needs a timescale hypertable: ${definition.tableName}`;
  return undefined;
}

/** Throws, before anything is touched, for the first table whose `retentionDays` cannot be applied. */
export function assertRetentionDeclarations(definitions: readonly RetentionShape[]): void {
  for (const definition of definitions) {
    const problem = retentionProblem(definition);
    if (problem) throw new Error(problem);
  }
}

/**
 * The retention policy of one hypertable is `days` days: added when missing, left alone when it is already that, replaced when it
 * is another. Running it again changes nothing. Explicit casts: extended-protocol params arrive as "unknown".
 */
export async function applyRetentionPolicy(pool: Pick<Pool, 'query'>, tableName: string, days: number): Promise<'added' | 'kept' | 'replaced'> {
  const current = await pool.query<{ same: boolean }>(
    `SELECT (config->>'drop_after')::interval = make_interval(days => $2::int) AS same
       FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_retention' AND hypertable_schema = current_schema() AND hypertable_name = $1::name`,
    [tableName, days],
  );
  if (current.rows.length === 1 && current.rows[0]?.same === true) return 'kept';
  if (current.rows.length > 0) {
    await pool.query('SELECT remove_retention_policy($1::regclass, if_exists => TRUE)', [tableName]);
  }
  await pool.query(
    'SELECT add_retention_policy($1::regclass, drop_after => make_interval(days => $2::int), if_not_exists => TRUE)',
    [tableName, days],
  );
  return current.rows.length > 0 ? 'replaced' : 'added';
}
