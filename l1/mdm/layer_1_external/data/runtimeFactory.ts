/// <mls fileReference="_102034_/l1/mdm/layer_1_external/data/runtimeFactory.ts" enhancement="_blank" />
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';

let sharedRuntime: IDataRuntime | null = null;

export function getSharedDataRuntime(): IDataRuntime {
  if (sharedRuntime) {
    return sharedRuntime;
  }

  const env = readAppEnv();
  sharedRuntime =
    env.runtimeMode === 'postgres'
      ? createPostgresDataRuntime(env)
      : createMemoryDataRuntime();

  return sharedRuntime;
}

export function resetSharedDataRuntime(): void {
  sharedRuntime = null;
}
