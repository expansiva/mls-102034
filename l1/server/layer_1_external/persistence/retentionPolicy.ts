/// <mls fileReference="_102034_/l1/server/layer_1_external/persistence/retentionPolicy.ts" enhancement="_blank"/>
/**
 * `TableDefinition.retentionDays` made real: a hypertable that declares it gets the Timescale retention policy; a value that is not a
 * whole number of days fails the bootstrap by the name of the table; a plain table comes up with a warning line (`retentionWarning`).
 */
import type { Pool } from 'pg';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

type RetentionShape = Pick<ResolvedTableDefinition, 'tableName' | 'retentionDays' | 'timescale'>;

/** Why the declaration is not acceptable (a value that is not a whole number of days, or is negative), or `undefined`. */
export function retentionProblem(definition: RetentionShape): string | undefined {
  const days = definition.retentionDays;
  if (days === undefined) return undefined;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) {
    return `retentionDays must be a whole number of days, 0 or more: ${definition.tableName}`;
  }
  return undefined;
}

/**
 * The table asks for a retention it cannot have: 1 day or more on a table that is not a hypertable (a plain table declares no
 * column for "when the row was written"). It comes up without the policy, and the registry carries this line, one per table.
 * 0 is how the generated definitions say "keep forever" (102046 declares it on 18 tables): no policy and no line.
 */
export function retentionWarning(definition: RetentionShape): string | undefined {
  const days = definition.retentionDays;
  if (days === undefined || days < 1 || definition.timescale?.hypertable) return undefined;
  return `retentionDays not applied: ${definition.tableName} is not a hypertable`;
}

/** Throws, before anything is touched, for the first table whose `retentionDays` is not acceptable. */
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
