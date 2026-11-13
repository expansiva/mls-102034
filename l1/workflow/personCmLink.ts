/// <mls fileReference="_102034_/l1/workflow/personCmLink.ts" enhancement="_blank"/>
import { createServerMessagesClient } from '/_102034_/l1/server/layer_1_external/collabMessages/client.js';
import { readMessagesIntegration } from '/_102034_/l1/server/layer_1_external/config/messagesIntegration.js';
import { AppError, type RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { createMessagesWorkflowIdentities } from '/_102034_/l1/workflow/messagesIdentities.js';

/**
 * Links a person of the register to the chat user at login, so the assistant can find the person from the chat
 * user alone (the link used to be born only when a workflow notified the person). Never blocks the login: a
 * failure is one log line with the code (no e-mail, no id) and the next login tries again. One call per person
 * per process once it worked.
 */
export type PersonCmLinker = (ctx: RequestContext, mdmId: string) => Promise<void>;

export interface PersonCmLinkDeps {
  /** True when this app has the cm integration (project file with the token). */
  isConfigured: () => boolean;
  /** The same call a workflow notice makes: creates the link by the login e-mail and does not duplicate. */
  toCmUserId: (ctx: RequestContext, mdmId: string) => Promise<string>;
  log?: (line: string) => void;
}

export function createPersonCmLinker(deps: PersonCmLinkDeps): PersonCmLinker {
  const done = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const log = deps.log ?? ((line: string) => console.error(line));
  return (ctx, mdmId) => {
    if (done.has(mdmId)) return Promise.resolve();
    const inFlight = running.get(mdmId);
    if (inFlight) return inFlight;
    const attempt = (async () => {
      try {
        if (!deps.isConfigured()) return;
        await deps.toCmUserId(ctx, mdmId);
        done.add(mdmId);
      } catch (error) {
        const code = error instanceof AppError && error.code ? error.code : 'unknown';
        log(`session/info cm link failed: ${code}`);
      } finally {
        running.delete(mdmId);
      }
    })();
    running.set(mdmId, attempt);
    return attempt;
  };
}

/** Production linker for the app `projectId`, built on the first login. */
export function createDefaultPersonCmLinker(projectId: () => string): PersonCmLinker {
  let linker: PersonCmLinker | undefined;
  return (ctx, mdmId) => {
    if (!linker) {
      const id = projectId();
      const identities = createMessagesWorkflowIdentities({ projectId: id, client: createServerMessagesClient({ projectId: id }) });
      linker = createPersonCmLinker({
        isConfigured: () => {
          try {
            readMessagesIntegration(id);
            return true;
          } catch {
            return false;
          }
        },
        toCmUserId: (context, person) => identities.toCmUserId(context, person),
      });
    }
    return linker(ctx, mdmId);
  };
}
