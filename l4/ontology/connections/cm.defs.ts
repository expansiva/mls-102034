/// <mls fileReference="_102034_/l4/ontology/connections/cm.defs.ts" enhancement="_blank"/>
/**
 * The connection to collab-messages (the cm): the 14 operations of `todo/projetos/agents/docs/conexoes.md` §5. The fields
 * come from `todo/projetos/nora/docs/agents-modulo-spec.md` §4.2, §4.3, §4.4, §16.2, §17.3 and §18. A field the spec does not
 * name is marked "not in the spec" and is waiting for the manager; none was invented without a mark.
 *
 * Who the call is about (organization, the person, the customer, the agent) travels in `ConnectionContext`, never in `input`.
 * `expectVersion` and `idempotencyKey` travel in the call options, never in `input`.
 */
import type { ConnectionCatalog } from '/_102034_/l4/ontology/connections/types.defs.js';

/** A tool of an agent: module, subject, action, with the purpose, the kind and the contract (§4.2). */
export interface CmTool {
  moduleId: string;
  /** The subject the action is about (the "assunto" of the tree). Not in the spec: where it comes from is open. */
  subject: string;
  actionId: string;
  purpose: string;
  kind: 'cmd' | 'qry';
  /** The inputs of the action, as the action catalog carries them. Not in the spec: the exact shape is open. */
  inputs?: unknown[];
}

export type CmAgentAudience = 'member' | 'room' | 'external';
/** The situation of a draft agent (§17.2): the cm is preparing it, it is ready to review, or it was refused. Not in the spec by these names. */
export type CmDraftStatus = 'preparing' | 'ready' | 'refused';

/** What a company can adjust (§4.2): turn ceilings, language, a cost ceiling below the maximum. The names are the cm's `AssistantConfigOverride`; not in the spec. */
export type CmAgentLimits = Record<string, string | number | boolean>;

export interface CmAgentCard {
  agentId: string;
  name: string;
  audience: CmAgentAudience;
  enabled: boolean;
  responsibleUserId?: string;
  /** Only on drafts. */
  draftStatus?: CmDraftStatus;
}

export interface CmListAgentsInput {
  includeDrafts?: boolean;
}
export interface CmListAgentsOutput {
  agents: CmAgentCard[];
}

export interface CmReadAgentInput {
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
  /** One version for definition, behavior and tools; `expectVersion` of the next change is this. */
  version: string;
}

/** Change by prompt, or by field: turn on/off, the responsible, the limits (§6). Exactly one way per call. The author is `context.actorUserId`. */
export interface CmUpdateAgentInput {
  agentId: string;
  prompt?: string;
  enabled?: boolean;
  responsibleUserId?: string;
  limits?: CmAgentLimits;
}
export interface CmUpdateAgentOutput {
  version: string;
  /** What `undoAgentChange` takes. Not in the spec: the undo has to name the change. */
  changeId: string;
}

export interface CmListAgentHistoryInput {
  agentId: string;
}
export interface CmAgentChange {
  changeId: string;
  /** ISO 8601. */
  at: string;
  authorUserId: string;
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

/** The levels of the first version (§7, §18.1): what it can, and what it understands. "What it would do" stays for later. Names not in the spec. */
export type CmSimulationLevel = 'canDo' | 'understands';
export interface CmSimulateAgentInput {
  agentId: string;
  level: CmSimulationLevel;
  /** Whom to simulate. The one who simulates is `context.actorUserId`. */
  as: string;
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
  /** The catalog of tools, so the cm can suggest tools in the same call (§18.3). */
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
  /** The format of the answer the caller wants (§18.3). Not in the spec: a JSON schema is assumed. */
  outputFormat: Record<string, unknown>;
}
export interface CmRunAiPromptOutput {
  result: unknown;
}

export interface CmAgentDraftReadyInput {
  draftId: string;
  status: 'ready' | 'refused';
  /** When refused: the reason in words. */
  reason?: string;
  /** When ready: the tools the model suggests, by action id. */
  suggestedTools?: string[];
}
export type CmAgentDraftReadyOutput = Record<string, never>;

export interface CmDescribeInput {
  agentId: string;
  /** The version the cm already has. */
  knownVersion?: string;
}
export interface CmDescribeOutput {
  version: string;
  /** Left out when `knownVersion` is the current one: only what depends on the actor is answered. */
  toolsMode?: 'all' | 'tree';
  tools?: CmTool[];
  /** The actions the actor of the context can use now. */
  allowed: string[];
}

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

export const cm: ConnectionCatalog = {
  "schemaVersion": "connection-catalog-v1",
  "connectionId": "cm",
  "title": "collab-messages",
  "description": "The conversations and the agents of the organization: reading and changing agents, simulating them, creating them from a prompt, and the two calls the cm makes to the app (what an agent can use, and what an agent did).",
  "operations": [
    { "operationId": "listAgents", "direction": "call", "kind": "query", "description": "List the agents of the organization, with the drafts and their situation.", "inputType": "CmListAgentsInput", "outputType": "CmListAgentsOutput", "reply": "now" },
    { "operationId": "readAgent", "direction": "call", "kind": "query", "description": "Read an agent: its definition, ROLE.md, STATE.md, whether it is on, who is responsible, its limits and its version.", "inputType": "CmReadAgentInput", "outputType": "CmReadAgentOutput", "reply": "now" },
    { "operationId": "updateAgent", "direction": "call", "kind": "command", "description": "Change an agent by a prompt or by a field, with the version that was read and the author; also turn it on or off, set the responsible and the limits.", "inputType": "CmUpdateAgentInput", "outputType": "CmUpdateAgentOutput", "reply": "now" },
    { "operationId": "listAgentHistory", "direction": "call", "kind": "query", "description": "List the changes of an agent, with the author and the date.", "inputType": "CmListAgentHistoryInput", "outputType": "CmListAgentHistoryOutput", "reply": "now" },
    { "operationId": "undoAgentChange", "direction": "call", "kind": "command", "description": "Undo one change of an agent, with the version that was read.", "inputType": "CmUndoAgentChangeInput", "outputType": "CmUndoAgentChangeOutput", "reply": "now" },
    { "operationId": "simulateAgent", "direction": "call", "kind": "command", "description": "Simulate an agent at the levels what it can and what it understands; nothing is saved.", "inputType": "CmSimulateAgentInput", "outputType": "CmSimulateAgentOutput", "reply": "now" },
    { "operationId": "createAgent", "direction": "call", "kind": "command", "description": "Ask the cm to create an agent from a prompt: the answer is only the id of the draft, and the result comes later.", "inputType": "CmCreateAgentInput", "outputType": "CmCreateAgentOutput", "reply": "later", "resultOperation": "agentDraftReady" },
    { "operationId": "activateAgent", "direction": "call", "kind": "command", "description": "Make a reviewed draft the agent that is in force.", "inputType": "CmActivateAgentInput", "outputType": "CmActivateAgentOutput", "reply": "now" },
    { "operationId": "discardAgentDraft", "direction": "call", "kind": "command", "description": "Throw away a draft agent.", "inputType": "CmDiscardAgentDraftInput", "outputType": "CmDiscardAgentDraftOutput", "reply": "now" },
    { "operationId": "listCmTools", "direction": "call", "kind": "query", "description": "List the tools of the cm itself, so they enter the tool catalog of the module.", "inputType": "CmListCmToolsInput", "outputType": "CmListCmToolsOutput", "reply": "now" },
    { "operationId": "runAiPrompt", "direction": "call", "kind": "command", "description": "Run one standalone AI prompt with a wanted answer format, outside any process task (choosing the new tools of a release).", "inputType": "CmRunAiPromptInput", "outputType": "CmRunAiPromptOutput", "reply": "now", "timeoutMs": 120000 },
    { "operationId": "agentDraftReady", "direction": "serve", "kind": "command", "description": "The cm tells the module that the preparation of a draft agent ended: ready, with suggested tools, or refused, with the reason.", "inputType": "CmAgentDraftReadyInput", "outputType": "CmAgentDraftReadyOutput", "reply": "now" },
    { "operationId": "describe", "direction": "serve", "kind": "query", "description": "The cm asks which tools an agent has for the person of the context: the version, the way to choose among them, the tools and the ones allowed now.", "inputType": "CmDescribeInput", "outputType": "CmDescribeOutput", "reply": "now", "hiddenFromAgents": true, "noRowLimit": true },
    { "operationId": "record", "direction": "serve", "kind": "command", "description": "The cm tells the module what an agent did in one execution; repeating the same execution does not record twice.", "inputType": "CmRecordInput", "outputType": "CmRecordOutput", "reply": "now", "hiddenFromAgents": true }
  ]
};

export default cm;
