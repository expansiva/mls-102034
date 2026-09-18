/// <mls fileReference="_102034_/l1/server/layer_2_application/tick/moduleTick.ts" enhancement="_blank" />
/**
 * The only clock the platform owns: once a minute it calls `onTick(ctx, now)` on every module that
 * exports one, in series, and gets out of the way.
 *
 * There is no alert table, no queue and no cron here on purpose (decision of 17/09/2026): a central
 * scheduler would have to know what every module wants and would go stale the first time a module
 * changed its mind. The module keeps its own occurrences in its own `tdm` table and decides, every
 * minute, whether it owes anything — `evaluateSchedule` next door reads the prose for it.
 *
 * One module's failure never reaches another: each call is isolated, and a tick that is still
 * running skips the next one instead of stacking.
 */
import { loadModuleTickHandlers, type ModuleTickRegistration } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getSharedIdentityCache } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';

export const MODULE_TICK_INTERVAL_MS = 60_000;

/** Builds the context one module sees on its tick. No request, no session: the caller is the platform. */
export type TickContextFactory = (moduleId: string) => RequestContext;

export function createTickContext(moduleId: string): RequestContext {
  // No sessionContext: the platform is the caller, not an actor. `createSessionContext` falls back
  // to the installation env, and inventing an actorId here would walk straight into the
  // authorization gate every generated controller reads (`execBff.ts:414-444`).
  return createRequestContext(getSharedDataRuntime(), {
    moduleId,
    cache: getSharedIdentityCache(),
  });
}

/** Calls every handler in series. A handler that throws is logged with its moduleId and the run continues. */
export async function runModuleTick(
  handlers: readonly ModuleTickRegistration[],
  createContext: TickContextFactory,
  now: Date,
): Promise<void> {
  for (const { moduleId, onTick } of handlers) {
    try {
      await onTick(createContext(moduleId), now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tick] module ${moduleId} failed on ${now.toISOString()}: ${message}`);
    }
  }
}

/**
 * The minute loop. `start()` resolves the handlers once and arms the interval; the timer is
 * `unref`ed so it never holds the process open, as the metrics sampler does.
 */
export class ModuleTickLoop {
  private timer: NodeJS.Timeout | null = null;
  private handlers: readonly ModuleTickRegistration[] = [];
  private running = false;

  public constructor(
    private readonly createContext: TickContextFactory = createTickContext,
    private readonly intervalMs: number = MODULE_TICK_INTERVAL_MS,
    /** Seam for the tests; the server always uses the registry. */
    private readonly loadHandlers: () => Promise<readonly ModuleTickRegistration[]> = loadModuleTickHandlers,
  ) {}

  public async start(): Promise<number> {
    if (this.timer) {
      return this.handlers.length;
    }
    this.handlers = await this.loadHandlers();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
    return this.handlers.length;
  }

  /** Exposed for the tests and for a future `POST /<module>/tick`; the loop calls it every minute. */
  public async runOnce(now: Date = new Date()): Promise<void> {
    if (this.running) {
      console.warn(`[tick] previous tick still running at ${now.toISOString()}; this minute is skipped`);
      return;
    }
    this.running = true;
    try {
      await runModuleTick(this.handlers, this.createContext, now);
    } finally {
      this.running = false;
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
