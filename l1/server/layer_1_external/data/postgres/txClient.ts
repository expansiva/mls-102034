/// <mls fileReference="_102034_/l1/server/layer_1_external/data/postgres/txClient.ts" enhancement="_blank" />
/**
 * What only the platform reads from the runtime of a module's data (`once`): whether it is the runtime of a transaction, and the SQL of that
 * transaction's connection, so a platform table commits or rolls back with the module's writes. It lives apart from `IModuleDataRuntime`
 * and from `moduleDataRuntime.ts`: generated code sees those and must not reach raw SQL.
 */
export interface PlatformTransactionAccess {
  inTransaction: boolean;
  sql?: { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
}

const access = new WeakMap<object, PlatformTransactionAccess>();

/** Called by the runtimes of the platform when they are built. */
export function registerPlatformTransactionAccess(runtime: object, value: PlatformTransactionAccess): void {
  access.set(runtime, value);
}

/** Undefined for a runtime the platform did not build (a fake, or one outside a transaction in memory). */
export function platformTransactionAccess(runtime: object): PlatformTransactionAccess | undefined {
  return access.get(runtime);
}
