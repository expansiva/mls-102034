/// <mls fileReference="_102034_/l2/shared/contracts/connections/types.ts" enhancement="_blank"/>
/**
 * The shape of a connection catalog: a closed list of typed operations between an app's backend and another system
 * (contract: the connections contract (conexoes.md) §1). Types only: a catalog file exports its own input and output
 * types next to its data, and generated code imports them from there; nobody redeclares them.
 */

/** The seven answers a caller tells apart. Never a silent error. */
export type ConnectionErrorCode = 'not_found' | 'disabled' | 'unavailable' | 'conflict' | 'refused' | 'forbidden' | 'invalid';

export type ConnectionResult<Output = unknown> =
  | { ok: true; output: Output }
  | {
    ok: false;
    code: ConnectionErrorCode;
    message: string;
    /** Ids of the settings or secrets that are not configured; only with `disabled`. */
    missing?: string[];
  };

/** Who the call is about, in every operation and in both directions. Outside `input`. */
export interface ConnectionContext {
  organizationId: string;
  /** The person of the action: the logged user, or on whose behalf the agent acts. */
  actorUserId?: string;
  /** The person by the mdm id. A call out of the app may carry it instead of `actorUserId`: the connector translates it to the id in the cm and never sends it. */
  actorMdmId?: string;
  /** An outside customer, when there is one. */
  customerId?: string;
  /** The agent involved, when there is one. */
  agentId?: string;
  /** Who asked, without authority (an agent in its own name). */
  requestedBy?: string;
  /** `requestedBy` by the mdm id, filled by the engine on arrival by the link of the login (never believed when it comes in the body); absent without the link. */
  requestedByMdmId?: string;
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
  /** serve: who answers is the platform (the engine), not a route of a module; no module marks `serves` for it. */
  servedBy?: 'platform';
  /** serve query: the answer has no row ceiling (describe). */
  noRowLimit?: boolean;
  /**
   * call: inputs that carry a person by the mdm id. The connector translates each `from` (an mdm id) to the id in the cm by
   * the link of the login (the same as `actorMdmId`), puts it in `to` and takes `from` out; without the link the answer is
   * `forbidden` and nothing is sent. The connector knows no operation by name: it reads this list.
   */
  personInputs?: Array<{ from: string; to: string }>;
  /** The caller must send `expectVersion` (the version it read); without it the other side answers `invalid`, with a stale one `conflict`. */
  expectsVersion?: true;
}

export interface ConnectionCatalog {
  schemaVersion: 'connection-catalog-v1';
  connectionId: string;
  title: string;
  description: string;
  operations: ConnectionOperation[];
}

/** One action of a module catalog, as the assistant catalog names it. Types only: the server that checks a catalog stays in the backend. */
export interface AssistantCatalogItem {
  route: string;
  routes?: string[];
  module?: string;
  kind: 'cmd' | 'qry';
  actionId: string;
  title?: string;
  /** Local actor ids (L4 `actorId`) that may use the action. */
  actors: string[];
  assistant: 'included' | 'excluded';
  risk?: string;
  /** Inputs of the operation; the one with `role: 'version'` is where `expectVersion` goes. */
  inputs?: Array<{ path?: string; role?: string; [field: string]: unknown }>;
  [field: string]: unknown;
}
