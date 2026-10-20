/// <mls fileReference="_102034_/l1/workflow/wakeLoop.ts" enhancement="_blank"/>
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { readAppEnv, type AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { resolveClientProjectId } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import type { ModuleWakeEvent } from '/_102036_/l2/shared/interfaces.js';
import {
  createWorkflowWakeDispatcher,
  type WorkflowWakeDispatcher,
} from '/_102034_/l1/workflow/wakeDispatch.js';
import { createPostgresWorkflowWakeInbox } from '/_102034_/l1/workflow/wakeInboxPostgres.js';
import type {
  WorkflowWakeDispatchResult,
  WorkflowWakeInbox,
} from '/_102034_/l1/workflow/wakeContracts.js';

const INTERVAL_MS = 5_000;
const MAX_PER_ROUND = 20;
const ERROR_CODE = /^WORKFLOW_WAKE_[A-Z0-9_]{1,48}$/;

export interface WorkflowWakeTimer {
  unref(): void;
}

export interface WorkflowWakeInboxLoopDeps {
  /** Server test seam. Production uses the configured client application. */
  resolveProjectId?: () => string;
  /** Server test seam. Production reads the process environment. */
  readEnv?: () => Pick<AppEnv, 'runtimeMode' | 'tickEnabled'>;
  /** Server test seam. Production opens the Postgres inbox lazily. */
  createStore?: (projectId: string) => WorkflowWakeInbox;
  /** Server test seam. Production uses the canonical dispatcher for the event module. */
  createDispatcher?: (projectId: string, moduleId: string) => WorkflowWakeDispatcher;
  intervalMs?: number;
  /** Server test seam. Production uses an unref'd interval. */
  schedule?: (callback: () => void, intervalMs: number) => WorkflowWakeTimer;
  /** Server test seam. Production clears the interval handle. */
  clearTimer?: (timer: WorkflowWakeTimer) => void;
}

/**
 * Drains wake events that are already in the inbox. It does not compute a
 * new period, open a task, or replace the CM scheduler.
 * The local running flag only skips an overlapping round in this process.
 * Two processes share the Postgres table and its advisory lock.
 */
export class WorkflowWakeInboxLoop {
  private timer: WorkflowWakeTimer | null = null;
  private started = false;
  private stopped = false;
  private running = false;
  private inflight: Promise<void> | null = null;
  private store: WorkflowWakeInbox | null = null;
  private projectId: string | null = null;

  private readonly resolveProjectId: () => string;
  private readonly readEnv: () => Pick<AppEnv, 'runtimeMode' | 'tickEnabled'>;
  private readonly createStore: (projectId: string) => WorkflowWakeInbox;
  private readonly createDispatcher: (projectId: string, moduleId: string) => WorkflowWakeDispatcher;
  private readonly intervalMs: number;
  private readonly schedule: (callback: () => void, intervalMs: number) => WorkflowWakeTimer;
  private readonly clearTimer: (timer: WorkflowWakeTimer) => void;

  public constructor(deps: WorkflowWakeInboxLoopDeps = {}) {
    this.resolveProjectId = deps.resolveProjectId ?? resolveClientProjectId;
    this.readEnv = deps.readEnv ?? readAppEnv;
    this.createStore = deps.createStore ?? ((projectId) => createPostgresWorkflowWakeInbox({ projectId }));
    this.createDispatcher = deps.createDispatcher ?? ((projectId, moduleId) => createWorkflowWakeDispatcher(projectId, moduleId));
    this.intervalMs = deps.intervalMs ?? INTERVAL_MS;
    this.schedule = deps.schedule ?? defaultSchedule;
    this.clearTimer = deps.clearTimer ?? defaultClear;
  }

  /** Idempotent. Runs one round immediately, then every five seconds. No-op on the memory runtime. */
  public async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    let postgres = false;
    try {
      postgres = this.readEnv().runtimeMode === 'postgres';
    } catch (error) {
      this.started = false;
      this.report(error);
      return;
    }
    if (!postgres) {
      this.started = false;
      return;
    }
    await this.runOnce();
    if (this.stopped || this.timer) return;
    this.timer = this.schedule(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
  }

  /** At most twenty due rows. `empty` ends the round; `busy` and `retry` leave the other rows eligible. */
  public async runOnce(): Promise<void> {
    if (this.stopped || this.running) return;
    try {
      if (this.readEnv().runtimeMode !== 'postgres') return;
    } catch (error) {
      this.report(error);
      return;
    }
    this.running = true;
    const round = this.drain();
    this.inflight = round;
    try {
      await round;
    } finally {
      this.running = false;
      if (this.inflight === round) this.inflight = null;
    }
  }

  /** Drops the timer and waits for the round that is already running. */
  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.inflight) await this.inflight;
  }

  private async drain(): Promise<void> {
    try {
      const inbox = this.inbox();
      const projectId = this.configuredProjectId();
      for (let n = 0; n < MAX_PER_ROUND; n += 1) {
        const result = await inbox.runNext(projectId, (event) => this.dispatch(event));
        if (result === 'empty') return;
      }
    } catch (error) {
      this.report(error);
    }
  }

  private inbox(): WorkflowWakeInbox {
    this.store ??= this.createStore(this.configuredProjectId());
    return this.store;
  }

  private configuredProjectId(): string {
    this.projectId ??= this.resolveProjectId();
    return this.projectId;
  }

  private async dispatch(event: ModuleWakeEvent): Promise<WorkflowWakeDispatchResult> {
    return this.createDispatcher(this.configuredProjectId(), event.ref.module).dispatch(event);
  }

  private report(error: unknown): void {
    console.warn(`[workflow-wake] ${sanitizedCode(error)}`);
  }
}

function sanitizedCode(error: unknown): string {
  const code = error instanceof AppError ? error.code : '';
  return ERROR_CODE.test(code) ? code : 'WORKFLOW_WAKE_LOOP_FAILED';
}

function defaultSchedule(callback: () => void, intervalMs: number): WorkflowWakeTimer {
  return setInterval(callback, intervalMs);
}

function defaultClear(timer: WorkflowWakeTimer): void {
  clearInterval(timer as NodeJS.Timeout);
}
