/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/callerModule.ts" enhancement="_blank"/>
/**
 * Which module is running. The platform knows it when it dispatches a route (`execBff`); the code of the module that calls a
 * connection never says it, and what it says is not believed. `callConnection` reads it here to stamp the call
 * (`ConnectionContext.callerModuleId`, the header `x-module-id` to the cm).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const running = new AsyncLocalStorage<{ moduleId: string }>();

/** Runs `work` (and everything it awaits) as the code of `moduleId`. */
export function runAsCallerModule<T>(moduleId: string, work: () => T): T {
  return running.run({ moduleId }, work);
}

/** The module whose route is running now, or `undefined` outside any route (the assistant, a job, a test). */
export function callerModuleOf(): string | undefined {
  const moduleId = running.getStore()?.moduleId;
  return moduleId === undefined || moduleId === '' ? undefined : moduleId;
}
