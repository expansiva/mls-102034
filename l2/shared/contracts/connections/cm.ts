/// <mls fileReference="_102034_/l2/shared/contracts/connections/cm.ts" enhancement="_blank"/>
/**
 * The connection to collab-messages (the cm): the 14 operations of the connections contract (conexoes.md) §5. The fields
 * come from the agents module spec §4.2, §4.3, §4.4, §16.2, §17.3 and §18; the fields that spec did not
 * define were decided by the manager in the connections contract (conexoes.md) §6.
 *
 * Who the call is about (organization, the person, the customer, the agent) travels in `ConnectionContext`, never in `input`.
 * `expectVersion` and `idempotencyKey` travel in the call options, never in `input`.
 */
import type { AssistantCatalogItem } from '/_102034_/l2/shared/contracts/connections/types.js';
import type { ConnectionCatalog } from '/_102034_/l2/shared/contracts/connections/types.js';

/**
 * A tool of an agent: module, subject, action, with the purpose, the kind and the contract (§4.2). The readable names of the
 * tree come ready (conexoes.md §6 item 10): the cm and the screen derive no name.
 */
export interface CmTool {
  moduleId: string;
  /** The title of the module (`title` of its `module.defs`). */
  moduleTitle?: string;
  /** The subject of the tree is the entity (`entityId`), not the page; `general` for an action that is about no entity (the screen labels it by the i18n). For a tool of the cm, a group the cm gives (e.g. `docs`). */
  subject: string;
  /** The title of the entity in the ontology of the L4. */
  subjectTitle?: string;
  actionId: string;
  /** The title of the action (the step of the journey, or the purpose). */
  title?: string;
  purpose: string;
  kind: 'cmd' | 'qry';
  /** The whole catalog item of today (`route`, `kind`, `actionId`, `actors`, `title`, `risk`, `inputs`...): the type `buildCatalogFromDefs` already uses, imported and not redeclared. */
  entry: AssistantCatalogItem;
}

export type CmAgentAudience = 'member' | 'room' | 'external';
/** The situation of a draft agent (§17.2): the cm is preparing it, it is ready to review, or it was refused. */
export type CmDraftStatus = 'preparing' | 'ready' | 'refused';

/**
 * What a company can adjust (§4.2): turn ceilings, language, a cost ceiling below the maximum. The cm answers a list the screen
 * shows without knowing the names: the `key` is a name of the cm's `AssistantConfigOverride` (only the cm knows them), the
 * `label` is in the language of the `context`.
 */
export interface CmAgentLimit {
  key: string;
  label: string;
  kind: 'number' | 'text' | 'boolean';
  value: number | string | boolean;
  max?: number;
}
export type CmAgentLimits = CmAgentLimit[];
/** What `updateAgent` sends for a limit. */
export interface CmAgentLimitValue {
  key: string;
  value: number | string | boolean;
}

export interface CmAgentCard {
  agentId: string;
  name: string;
  audience: CmAgentAudience;
  enabled: boolean;
  responsibleUserId?: string;
  /** Only on drafts. */
  draftStatus?: CmDraftStatus;
  /** With `refused`: the reason in words (§17.1). */
  refusedReason?: string;
}

export interface CmListAgentsInput {
  includeDrafts?: boolean;
}
export interface CmListAgentsOutput {
  agents: CmAgentCard[];
}

export interface CmReadAgentInput {
  /** The id of an agent, or of a draft (`draftId`). */
  agentId: string;
}
export interface CmReadAgentOutput {
  agentId: string;
  name: string;
  audience: CmAgentAudience;
  /** The definition, `ROLE.md` and `STATE.md` of the agent, as text. */
  definition: string;
  role: string;
  state: string;
  enabled: boolean;
  responsibleUserId?: string;
  limits: CmAgentLimits;
  /** The member of the agent in the mdm of the app that asks; absent before the agent is active. */
  mdmId?: string;
  /** Only for the Nora: what the person of the context wrote for herself (§4.4, `agentConduct`). */
  personal?: { role: string; state: string };
  /** One version for definition, behavior and tools; `expectVersion` of the next change is this. */
  version: string;
}

/** Change by prompt, or by field: turn on/off, the responsible, the limits (§6). Exactly one way per call. The author is `context.actorUserId`. */
export interface CmUpdateAgentInput {
  /** The id of an agent, or of a draft (`draftId`). */
  agentId: string;
  /** `company` (default): the agent of the company; `personal`: the conduct of the person of the context. */
  scope?: 'company' | 'personal';
  /**
   * The name the agent is called by in the chat (`@<name>`): one word of 2 to 24 characters, with letters, digits, `.`, `_` or `-`.
   * Out of that form the cm answers `invalid`; a name already used answers `conflict`.
   */
  name?: string;
  prompt?: string;
  enabled?: boolean;
  responsibleUserId?: string;
  limits?: CmAgentLimitValue[];
}
export interface CmUpdateAgentOutput {
  version: string;
  /** What `undoAgentChange` takes: the undo names the change (and goes with `expectVersion` in the options). */
  changeId: string;
  /** One-line summary of what a prompt change altered, made by the cm. */
  summary?: string;
}

export interface CmListAgentHistoryInput {
  agentId: string;
}
export interface CmAgentChange {
  changeId: string;
  /** ISO 8601. */
  at: string;
  authorUserId: string;
  /** One-line summary of what a prompt change altered, made by the cm. */
  summary?: string;
}
export interface CmListAgentHistoryOutput {
  changes: CmAgentChange[];
}

export interface CmUndoAgentChangeInput {
  agentId: string;
  changeId: string;
}
export interface CmUndoAgentChangeOutput {
  version: string;
}

/** The levels of the first version (§7, §18.1): what it can, and what it understands. "What it would do" stays for later. */
export type CmSimulationLevel = 'canDo' | 'understands';
/** The connector translates `asMdmId` to `as` (see `personInputs` of `simulateAgent`): the module only knows the mdm id. */
export interface CmSimulateAgentInput {
  /** The id of an agent, or of a draft (`draftId`). */
  agentId: string;
  level: CmSimulationLevel;
  /** A person to simulate, by the mdm id; the connector turns it into `as`. */
  asMdmId?: string;
  /** Whom to simulate: the id of the user in the cm (what reaches the cm when `asMdmId` is used), or a role `<moduleId>:<actorId>`. The one who simulates is `context.actorUserId`. */
  as?: string;
  /** For `understands`: the sentence. */
  message?: string;
  /** To simulate a behavior not saved yet. */
  draftInstructions?: string;
}
export interface CmSimulationCanDoRow {
  actionId: string;
  allowed: boolean;
  /** Why it can or cannot. */
  reason: string;
}
export interface CmSimulateAgentOutput {
  level: CmSimulationLevel;
  /** canDo: every action of the tree with "can"/"cannot" and the reason; and the context that would be sent. */
  tree?: CmSimulationCanDoRow[];
  context?: Record<string, unknown>;
  /** understands: whether the sentence is a request for an action, the path of the tree, and the actions. */
  isActionRequest?: boolean;
  path?: string[];
  actions?: string[];
}

export interface CmCreateAgentInput {
  /** The text of the person: what the agent is and what it does. */
  prompt: string;
  /** The catalog of tools, so the cm can suggest tools in the same call (§18.3). The whole catalog travels only here and in `runAiPrompt`. */
  catalog?: CmTool[];
}
export interface CmCreateAgentOutput {
  /** The result comes later, through `agentDraftReady`. */
  draftId: string;
}

export interface CmActivateAgentInput {
  draftId: string;
}
export interface CmActivateAgentOutput {
  /** The `draftId` of `createAgent` is already the final id: this is the same value, not a new one. */
  agentId: string;
}

export interface CmDiscardAgentDraftInput {
  draftId: string;
}
export interface CmDiscardAgentDraftOutput {
  discarded: true;
}

export type CmListCmToolsInput = Record<string, never>;
export interface CmListCmToolsOutput {
  tools: CmTool[];
}

export interface CmRunAiPromptInput {
  prompt: string;
  /** The format of the answer the caller wants (§18.3): a JSON schema. */
  outputFormat: Record<string, unknown>;
}
export interface CmRunAiPromptOutput {
  result: unknown;
}

export interface CmAgentDraftReadyInput {
  draftId: string;
  status: 'ready' | 'refused';
  /** When refused: the reason in words, the same as `refusedReason` of the card. */
  refusedReason?: string;
  /** When ready: the tools the model suggests, by action id. */
  suggestedTools?: string[];
}
export type CmAgentDraftReadyOutput = Record<string, never>;

export interface CmDescribeInput {
  agentId: string;
  /** The version the cm already has. */
  knownVersion?: string;
  /** The raw authorities of the person, `<moduleId>:<actorId>`, as the `onBehalfOf` of today's `catalog` carries them: without them `allowed` cannot be computed (cm answer, 17/11). */
  authorities: string[];
  /** When the cm took those roles (ISO 8601), as the `onBehalfOf` of today's `catalog` carries it. */
  snapshotAt: string;
}
/** Same version as `knownVersion`: only what depends on the actor. Valid only when `knownVersion` equals the current version. */
export interface CmDescribeSameVersion {
  version: string;
  allowed: string[];
  toolsMode?: never;
  tools?: never;
}
/** Full answer: always when the version is not the one the cm knows. `version` is never empty and changes whenever the linked tools change. */
export interface CmDescribeFull {
  version: string;
  toolsMode: 'all' | 'tree';
  tools: CmTool[];
  allowed: string[];
}
export type CmDescribeOutput = CmDescribeSameVersion | CmDescribeFull;

export type CmRecordOutcome = 'done' | 'refused_rule' | 'forbidden' | 'no_person' | 'not_found' | 'stale_version' | 'invalid_input' | 'unavailable';
export interface CmRecordInput {
  /** The identity of the execution; a repeat does not record again. */
  executionId: string;
  agentId: string;
  /** Whether it counted (`real`) or was a rehearsal. */
  mode: 'real' | 'rehearsal';
  /** ISO 8601. */
  startedAt: string;
  durationMs: number;
  costUsd: number;
  actions: Array<{ actionId: string; outcome: CmRecordOutcome }>;
  usedMainModel: boolean;
  handedOff: boolean;
  refs: { conversationId?: string; taskId?: string; messageId?: string };
}
export interface CmRecordOutput {
  status: 'recorded' | 'existing';
}

export interface CmEnsureAgentMemberInput {
  agentId: string;
  name: string;
  active: boolean;
}
export interface CmEnsureAgentMemberOutput {
  mdmId: string;
}

export const cm: ConnectionCatalog = {
  "schemaVersion": "connection-catalog-v1",
  "connectionId": "cm",
  "title": "collab-messages",
  "description": "The conversations and the agents of the organization: reading and changing agents, simulating them, creating them from a prompt, and the two calls the cm makes to the app (what an agent can use, and what an agent did).",
  "operations": [
    { "operationId": "listAgents", "direction": "call", "kind": "query", "description": "List the agents of the organization, with the drafts and their situation.", "inputType": "CmListAgentsInput", "outputType": "CmListAgentsOutput", "reply": "now" },
    { "operationId": "readAgent", "direction": "call", "kind": "query", "description": "Read an agent: its definition, ROLE.md, STATE.md, whether it is on, who is responsible, its limits and its version.", "inputType": "CmReadAgentInput", "outputType": "CmReadAgentOutput", "reply": "now" },
    { "operationId": "updateAgent", "direction": "call", "kind": "command", "description": "Change an agent by a prompt or by a field, with the version that was read and the author; also turn it on or off, set the responsible and the limits.", "inputType": "CmUpdateAgentInput", "outputType": "CmUpdateAgentOutput", "reply": "now", "expectsVersion": true },
    { "operationId": "listAgentHistory", "direction": "call", "kind": "query", "description": "List the changes of an agent, with the author and the date.", "inputType": "CmListAgentHistoryInput", "outputType": "CmListAgentHistoryOutput", "reply": "now" },
    { "operationId": "undoAgentChange", "direction": "call", "kind": "command", "description": "Undo one change of an agent, with the version that was read.", "inputType": "CmUndoAgentChangeInput", "outputType": "CmUndoAgentChangeOutput", "reply": "now", "expectsVersion": true },
    { "operationId": "simulateAgent", "direction": "call", "kind": "command", "description": "Simulate an agent at the levels what it can and what it understands; nothing is saved. A person the cm holds no current roles for (they have not used the assistant, or not recently) answers the error refused; every other failure is invalid or not_found.", "inputType": "CmSimulateAgentInput", "outputType": "CmSimulateAgentOutput", "reply": "now", "personInputs": [{ "from": "asMdmId", "to": "as" }] },
    { "operationId": "createAgent", "direction": "call", "kind": "command", "description": "Ask the cm to create an agent from a prompt: the answer is only the id of the draft, and the result comes later.", "inputType": "CmCreateAgentInput", "outputType": "CmCreateAgentOutput", "reply": "later", "resultOperation": "agentDraftReady" },
    { "operationId": "activateAgent", "direction": "call", "kind": "command", "description": "Make a reviewed draft the agent that is in force.", "inputType": "CmActivateAgentInput", "outputType": "CmActivateAgentOutput", "reply": "now", "expectsVersion": true },
    { "operationId": "discardAgentDraft", "direction": "call", "kind": "command", "description": "Throw away a draft agent.", "inputType": "CmDiscardAgentDraftInput", "outputType": "CmDiscardAgentDraftOutput", "reply": "now" },
    { "operationId": "listCmTools", "direction": "call", "kind": "query", "description": "List the tools of the cm itself, so they enter the tool catalog of the module.", "inputType": "CmListCmToolsInput", "outputType": "CmListCmToolsOutput", "reply": "now" },
    { "operationId": "runAiPrompt", "direction": "call", "kind": "command", "description": "Run one standalone AI prompt with a wanted answer format, outside any process task (choosing the new tools of a release).", "inputType": "CmRunAiPromptInput", "outputType": "CmRunAiPromptOutput", "reply": "now", "timeoutMs": 120000 },
    { "operationId": "agentDraftReady", "direction": "serve", "kind": "command", "description": "The cm tells the module that the preparation of a draft agent ended: ready, with suggested tools, or refused, with the reason.", "inputType": "CmAgentDraftReadyInput", "outputType": "CmAgentDraftReadyOutput", "reply": "now" },
    { "operationId": "describe", "direction": "serve", "kind": "query", "description": "The cm asks which tools an agent has for the person of the context. version is never empty and changes whenever the list of linked tools changes. An agent with no linked tool answers the full form { version: \"empty\", toolsMode: \"all\", tools: [], allowed: [] }. The same-version form, version and allowed only, is valid only when knownVersion equals the current version. An agent this app does not know answers the error not_found, and the cm skips the app.", "inputType": "CmDescribeInput", "outputType": "CmDescribeOutput", "reply": "now", "hiddenFromAgents": true, "noRowLimit": true },
    { "operationId": "ensureAgentMember", "direction": "serve", "kind": "command", "description": "Make the agent a member of the organization (an mdm person, no login): create it, or set its name and whether it is active. Never deleted. Same agentId, same member.", "inputType": "CmEnsureAgentMemberInput", "outputType": "CmEnsureAgentMemberOutput", "reply": "now", "hiddenFromAgents": true, "servedBy": "platform" },
    { "operationId": "record", "direction": "serve", "kind": "command", "description": "The cm tells the module what an agent did in one execution; repeating the same execution does not record twice.", "inputType": "CmRecordInput", "outputType": "CmRecordOutput", "reply": "now", "hiddenFromAgents": true }
  ]
};

export default cm;
