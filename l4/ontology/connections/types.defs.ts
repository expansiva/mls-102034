/// <mls fileReference="_102034_/l4/ontology/connections/types.defs.ts" enhancement="_blank"/>
/**
 * The shape of a connection catalog: a closed list of typed operations between an app's backend and another system
 * (contract: `todo/projetos/agents/docs/conexoes.md` §1). Types only: a catalog file exports its own input and output
 * types next to its data, and generated code imports them from there; nobody redeclares them.
 */

/** The seven answers a caller tells apart. Never a silent error. */
export type ConnectionErrorCode = 'not_found' | 'disabled' | 'unavailable' | 'conflict' | 'refused' | 'forbidden' | 'invalid';

export type ConnectionResult<Output = unknown> =
  | { ok: true; output: Output }
  | { ok: false; code: ConnectionErrorCode; message: string };

/** Who the call is about, in every operation and in both directions. Outside `input`. */
export interface ConnectionContext {
  organizationId: string;
  /** The person of the action: the logged user, or on whose behalf the agent acts. */
  actorUserId?: string;
  /** An outside customer, when there is one. */
  customerId?: string;
  /** The agent involved, when there is one. */
  agentId?: string;
  /** Who asked, without authority (an agent in its own name). */
  requestedBy?: string;
}

export interface ConnectionOperation {
  /** Unique in the connection; lowerCamel. */
  operationId: string;
  /** call: the module calls the outside system. serve: the outside system calls the module. */
  direction: 'call' | 'serve';
  kind: 'query' | 'command';
  /** What the NS5 chooses by. Intent, not a script. */
  description: string;
  /** Names of TS types exported in the SAME file as the catalog. */
  inputType: string;
  outputType: string;
  /** now: the answer comes in the call. later: only an id comes; the result arrives through the serve operation `resultOperation`. */
  reply: 'now' | 'later';
  resultOperation?: string;
  /** Longest wait of the call; the connector uses a default when it is missing. */
  timeoutMs?: number;
  /** serve: stays out of the catalog of tools the agents see (describe, record). */
  hiddenFromAgents?: boolean;
  /** serve query: the answer has no row ceiling (describe). */
  noRowLimit?: boolean;
}

export interface ConnectionCatalog {
  schemaVersion: 'connection-catalog-v1';
  connectionId: string;
  title: string;
  description: string;
  operations: ConnectionOperation[];
}
