/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmBench.ts" enhancement="_blank" />
/**
 * The cm of the script, FOR TESTS ONLY. It replaces what the network of the cm would answer, and nothing else: `cm(ctx)`,
 * `callConnection` (context, translation of people, the call record) and, the other way, `connectionServe` → route → `serveCm` → `once`
 * are the real code. An operation without a script answers `unavailable`, never an invented success. The bench changes the data of the
 * environment (what the cm says, the organization, who is linked to whom), never the wiring: say "cm of the script" in the proof.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { setCmBenchForTests } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import type { ConnectionRequest } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import { resetProjectsConfigCache, resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { createAssistantRunners } from '/_102034_/l1/workflow/assistantRuntime.js';
import { setDefsSourceFallbackForTests } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import type { CmCallId, CmCallOperations, CmServeId, CmServeOperations } from '/_102034_/l2/shared/contracts/connections/cm.js';
import type { ConnectionContext, ConnectionResult } from '/_102034_/l2/shared/contracts/connections/types.js';

export type CmScript = {
  [K in CmCallId]?: (input: CmCallOperations[K]['input'], context: ConnectionContext) =>
    ConnectionResult<CmCallOperations[K]['output']> | Promise<ConnectionResult<CmCallOperations[K]['output']>>;
};

export interface CmBench {
  /** Every call the module made, in order, with the key used. */
  calls: Array<{ operationId: CmCallId; input: unknown; context: ConnectionContext; idempotencyKey?: string }>;
  /** A request of the cm to the module, through the REAL connectionServe of the project (index of the release, authorize, transaction). */
  serve<K extends CmServeId>(
    operationId: K,
    input: CmServeOperations[K]['input'],
    context: ConnectionContext,
    options?: { targetModuleId?: string; idempotencyKey?: string },
  ): Promise<ConnectionResult<CmServeOperations[K]['output']>>;
  restore(): void;
}

export interface CmBenchOptions {
  /** The folder of the project (source `.ts` or `dist`, as a `git archive` of `mls-<id>` gives): the release readers read from there. Without it, production paths are used as they are. */
  projectRoot?: string;
  /** The organization of the app. Default: `org-bench`. */
  organizationId?: string;
  /** Who is linked in the cm: mdm id → user id in the cm. Anyone else is unlinked. */
  people?: Record<string, string>;
}

/** The client config of the project, composed from the folders the way the publish composer does (controllers, composition roots). */
function composeProjectConfig(realProjectsDir: string, projectId: string, projectRoot: string): unknown {
  const config = JSON.parse(readFileSync(join(realProjectsDir, 'config.json'), 'utf8')) as { defaultProjectId?: string; projects: Record<string, Record<string, unknown>> };
  // A workspace has exactly one client: the project of the bench takes the place of the one of the real config.
  for (const [id, project] of Object.entries(config.projects)) {
    if (project.type === 'client' && id !== projectId) delete config.projects[id];
  }
  config.defaultProjectId = projectId;
  const l1 = join(projectRoot, 'l1');
  const modules = existsSync(l1)
    ? readdirSync(l1).filter((name) => existsSync(join(l1, name, 'layer_1_external', 'adapters', 'http', 'controllers'))).sort()
    : [];
  const previous = config.projects[projectId] ?? {};
  config.projects[projectId] = {
    ...previous,
    root: `../mls-${projectId}`,
    type: 'client',
    modules: modules.map((moduleId) => ({
      moduleId,
      shellMode: 'spa',
      basePath: `/${moduleId}`,
      backendControllers: `./_${projectId}_/l1/${moduleId}/layer_1_external/adapters/http/controllers`,
      frontend: { layer: 'l2', pages: [] },
    })),
    persistenceModules: modules.map((moduleId) => ({ moduleId, tableDefsDir: `./_${projectId}_/l1/${moduleId}/layer_1_external/adapters/persistence` })),
  };
  return config;
}

export function installCmBench(projectId: string, script: CmScript, options: CmBenchOptions = {}): CmBench {
  const calls: CmBench['calls'] = [];
  const people = options.people ?? {};
  const previousCwd = process.cwd();
  let sandbox: string | undefined;

  if (options.projectRoot !== undefined) {
    // A projects folder of its own: the config composed for the project, the platform and the other projects linked from the real
    // one, and the project itself linked from `projectRoot`. `resolveProjectDistPath` already falls back to `mls-<id>` source.
    const real = resolveProjectsPath('.');
    sandbox = mkdtempSync(join(tmpdir(), 'cm-bench-'));
    for (const name of readdirSync(real)) {
      if (/^mls-\d+$/u.test(name) && name !== `mls-${projectId}`) symlinkSync(join(real, name), join(sandbox, name));
    }
    symlinkSync(options.projectRoot, join(sandbox, `mls-${projectId}`));
    if (existsSync(join(real, 'dist'))) mkdirSync(join(sandbox, 'dist'));
    writeFileSync(join(sandbox, 'config.json'), JSON.stringify(composeProjectConfig(real, projectId, options.projectRoot)));
    if (existsSync(join(options.projectRoot, 'dist', 'local'))) cpSync(join(options.projectRoot, 'dist', 'local'), join(sandbox, 'dist', 'local'), { recursive: true });
    process.chdir(sandbox);
    resetProjectsConfigCache();
    setDefsSourceFallbackForTests(true);
  }

  setCmBenchForTests({
    projectId,
    organizationId: options.organizationId ?? 'org-bench',
    transport: async (request: ConnectionRequest) => {
      const operationId = request.operation.operationId as CmCallId;
      calls.push({ operationId, input: request.input, context: request.context, ...(request.opts.idempotencyKey !== undefined ? { idempotencyKey: request.opts.idempotencyKey } : {}) });
      const handler = script[operationId] as ((input: unknown, context: ConnectionContext) => ConnectionResult | Promise<ConnectionResult>) | undefined;
      if (!handler) return { ok: false, code: 'unavailable', message: `cm bench: ${operationId} not scripted` };
      return (await handler(request.input, request.context)) as unknown as Record<string, unknown>;
    },
    toCmUserId: async (mdmId) => {
      const cmUserId = people[mdmId];
      if (cmUserId === undefined) throw new AppError('WORKFLOW_IDENTITY_UNLINKED', 'The person has no link in the cm bench.', 404);
      return cmUserId;
    },
    toMdmId: async (cmUserId) => {
      const mdmId = Object.entries(people).find(([, value]) => value === cmUserId)?.[0];
      if (mdmId === undefined) throw new AppError('WORKFLOW_IDENTITY_UNLINKED', 'The person has no link in the cm bench.', 404);
      return mdmId;
    },
  });

  const runners = createAssistantRunners(projectId);
  return {
    calls,
    serve: (operationId, input, context, serveOptions) => runners.connection({
      connectionId: 'cm',
      operationId,
      input,
      context,
      ...(serveOptions?.targetModuleId !== undefined ? { targetModuleId: serveOptions.targetModuleId } : {}),
      ...(serveOptions?.idempotencyKey !== undefined ? { idempotencyKey: serveOptions.idempotencyKey } : {}),
    }) as never,
    restore() {
      setCmBenchForTests(undefined);
      if (sandbox !== undefined) {
        process.chdir(previousCwd);
        resetProjectsConfigCache();
        setDefsSourceFallbackForTests(false);
        rmSync(sandbox, { recursive: true, force: true });
        sandbox = undefined;
      }
    },
  };
}
