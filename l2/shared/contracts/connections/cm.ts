/// <mls fileReference="_102034_/l2/shared/contracts/connections/cm.ts" enhancement="_blank"/>
/**
 * The connection to collab-messages (the cm): the operations of the connections contract (conexoes.md) §5. The fields
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
  /** The id of the person in the app (the mdm id): the connector translates it to the id in the cm (`personInputs` of `updateAgent`, `personOutputs` of `listAgents` and `readAgent`). The app and the cm are linked by the login email; their ids are different: never send an app id to the cm nor use a cm id in the app. */
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
  /** The id of the person in the app (the mdm id): the connector translates it to the id in the cm (`personInputs` of `updateAgent`, `personOutputs` of `listAgents` and `readAgent`). The app and the cm are linked by the login email; their ids are different: never send an app id to the cm nor use a cm id in the app. */
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
  /** The id of the person in the app (the mdm id): the connector translates it to the id in the cm (`personInputs` of `updateAgent`, `personOutputs` of `listAgents` and `readAgent`). The app and the cm are linked by the login email; their ids are different: never send an app id to the cm nor use a cm id in the app. */
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
  /** The id of the person in the app (the mdm id): the connector translates it from the id in the cm (`personOutputs` of `listAgentHistory`); the field leaves the item when the author has no link with this app. The app and the cm are linked by the login email; their ids are different: never send an app id to the cm nor use a cm id in the app. */
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
  /** A person to simulate, by the mdm id; the connector turns it into `as`. The app and the cm are linked by the login email; their ids are different: never send an app id to the cm nor use a cm id in the app. */
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

/** A text a person wrote in a conversation of a channel (Telegram, WhatsApp…), delivered to the cm. The agent that answers goes in `context.agentId`; the repeat key in the call options. */
export interface CmChannelMessageReceivedInput {
  /** The reference of the conversation in the channel, as the channel module names it. */
  conversationRef: string;
  audience: CmAgentAudience;
  conversationKind: 'person' | 'group';
  /** Who wrote the text. */
  author: { channelAccountId: string; name: string };
  /** When the person wrote it, ISO 8601. */
  writtenAt: string;
  text: string;
}
export interface CmChannelMessageReceivedOutput {
  /** The room of the conversation in the cm. */
  threadId: string;
  /** The reference the cm gave to the message. */
  messageRef: string;
}

/** The cm asks the channel module to send a text. A refusal is the error `refused` (e.g. the Telegram accepts no `address`). */
export interface CmSendChannelMessageInput {
  /** An existing conversation, or an address of the channel with the bot that sends it. */
  to: { conversationRef: string } | { address: string; botRef: string };
  text: string;
  /** When the message was written in the cm (ISO 8601 with fractions of a second); the same on every retry of the same send. */
  writtenAt: string;
  /** The id of the message in the cm; the same on every retry of the same send. */
  messageRef: string;
}
export interface CmSendChannelMessageOutput {
  /** The id the channel gave to the message sent. */
  channelMessageId: string;
}

/** The cm tells the channel module who the person of a conversation is. No `identity` clears it (back to anonymous). */
export interface CmSetChannelConversationIdentityInput {
  conversationRef: string;
  /** The person, by e-mail or by the mdm id; absent clears it. */
  identity?: { email: string } | { mdmId: string };
  displayName?: string;
  /** Since when the identity holds, ISO 8601. */
  since?: string;
}
export interface CmSetChannelConversationIdentityOutput {}

/** The cm asks to block a conversation or to pause a bot of the channel. */
export interface CmDisableChannelInput {
  target: { conversationRef: string } | { botRef: string };
  /** Why it is disabled. */
  reason: string;
}
export interface CmDisableChannelOutput {}

/** A module asks the cm to tell a person something. A refusal is the error `refused`. */
export interface CmNotifyPersonInput {
  /** How to reach the person (e-mail, phone, handle of a channel). */
  contact: string;
  /** The person in the mdm, when the module knows it. */
  mdmId?: string;
  text: string;
}
export interface CmNotifyPersonOutput {
  /** `no_channel`: the cm found no channel to reach the person. */
  status: 'sent' | 'no_channel';
}

export const cm: ConnectionCatalog = {
  "schemaVersion": "connection-catalog-v1",
  "connectionId": "cm",
  "title": "collab-messages",
  "description": "The conversations and the agents of the organization: reading and changing agents, simulating them, creating them from a prompt, and the two calls the cm makes to the app (what an agent can use, and what an agent did), and the channels (Telegram, WhatsApp…): a channel module delivers what a person wrote and the cm asks it to send, to identify a conversation or to disable it; any module can ask the cm to notify a person.",
  "operations": [
    { "operationId": "listAgents", "direction": "call", "kind": "query", "description": "List the agents of the organization, with the drafts and their situation.", "inputType": "CmListAgentsInput", "outputType": "CmListAgentsOutput", "reply": "now", "personOutputs": ["agents[].responsibleUserId"] },
    { "operationId": "readAgent", "direction": "call", "kind": "query", "description": "Read an agent: its definition, ROLE.md, STATE.md, whether it is on, who is responsible, its limits and its version.", "inputType": "CmReadAgentInput", "outputType": "CmReadAgentOutput", "reply": "now", "personOutputs": ["responsibleUserId"] },
    { "operationId": "updateAgent", "direction": "call", "kind": "command", "description": "Change an agent by a prompt or by a field, with the version that was read and the author; also turn it on or off, set the responsible and the limits.", "inputType": "CmUpdateAgentInput", "outputType": "CmUpdateAgentOutput", "reply": "now", "expectsVersion": true, "personInputs": [{ "from": "responsibleUserId", "to": "responsibleUserId" }] },
    { "operationId": "listAgentHistory", "direction": "call", "kind": "query", "description": "List the changes of an agent, with the author and the date.", "inputType": "CmListAgentHistoryInput", "outputType": "CmListAgentHistoryOutput", "reply": "now", "personOutputs": ["changes[].authorUserId"] },
    { "operationId": "undoAgentChange", "direction": "call", "kind": "command", "description": "Undo one change of an agent, with the version that was read.", "inputType": "CmUndoAgentChangeInput", "outputType": "CmUndoAgentChangeOutput", "reply": "now", "expectsVersion": true },
    { "operationId": "simulateAgent", "direction": "call", "kind": "command", "description": "Simulate an agent at the levels what it can and what it understands; nothing is saved. A person the cm holds no current roles for (they have not used the assistant, or not recently) answers the error refused; every other failure is invalid or not_found.", "inputType": "CmSimulateAgentInput", "outputType": "CmSimulateAgentOutput", "reply": "now", "personInputs": [{ "from": "asMdmId", "to": "as" }] },
    { "operationId": "createAgent", "direction": "call", "kind": "command", "description": "Ask the cm to create an agent from a prompt: the answer is only the id of the draft, and the result comes later.", "inputType": "CmCreateAgentInput", "outputType": "CmCreateAgentOutput", "reply": "later", "resultOperation": "agentDraftReady" },
    { "operationId": "activateAgent", "direction": "call", "kind": "command", "description": "Make a reviewed draft the agent that is in force.", "inputType": "CmActivateAgentInput", "outputType": "CmActivateAgentOutput", "reply": "now", "expectsVersion": true },
    { "operationId": "discardAgentDraft", "direction": "call", "kind": "command", "description": "Throw away a draft agent.", "inputType": "CmDiscardAgentDraftInput", "outputType": "CmDiscardAgentDraftOutput", "reply": "now" },
    { "operationId": "listCmTools", "direction": "call", "kind": "query", "description": "List the tools of the cm itself, so they enter the tool catalog of the module.", "inputType": "CmListCmToolsInput", "outputType": "CmListCmToolsOutput", "reply": "now" },
    { "operationId": "runAiPrompt", "direction": "call", "kind": "command", "description": "Run one standalone AI prompt with a wanted answer format, outside any process task (choosing the new tools of a release).", "inputType": "CmRunAiPromptInput", "outputType": "CmRunAiPromptOutput", "reply": "now", "timeoutMs": 630000 },
    { "operationId": "agentDraftReady", "direction": "serve", "kind": "command", "description": "The cm tells the module that the preparation of a draft agent ended: ready, with suggested tools, or refused, with the reason.", "inputType": "CmAgentDraftReadyInput", "outputType": "CmAgentDraftReadyOutput", "reply": "now" },
    { "operationId": "describe", "direction": "serve", "kind": "query", "description": "The cm asks which tools an agent has for the person of the context. version is never empty and changes whenever the list of linked tools changes. An agent with no linked tool answers the full form { version: \"empty\", toolsMode: \"all\", tools: [], allowed: [] }. The same-version form, version and allowed only, is valid only when knownVersion equals the current version. An agent this app does not know answers the error not_found, and the cm skips the app.", "inputType": "CmDescribeInput", "outputType": "CmDescribeOutput", "reply": "now", "hiddenFromAgents": true, "noRowLimit": true },
    { "operationId": "ensureAgentMember", "direction": "serve", "kind": "command", "description": "Make the agent a member of the organization (an mdm person, no login): create it, or set its name and whether it is active. Never deleted. Same agentId, same member.", "inputType": "CmEnsureAgentMemberInput", "outputType": "CmEnsureAgentMemberOutput", "reply": "now", "hiddenFromAgents": true, "servedBy": "platform" },
    { "operationId": "record", "direction": "serve", "kind": "command", "description": "The cm tells the module what an agent did in one execution; repeating the same execution does not record twice.", "inputType": "CmRecordInput", "outputType": "CmRecordOutput", "reply": "now", "hiddenFromAgents": true },
    { "operationId": "channelMessageReceived", "direction": "call", "kind": "command", "description": "Deliver to the cm a text message a person wrote in a conversation of a channel (Telegram, WhatsApp…): the conversation reference, the audience, the agent that answers, the author, when and the text. The cm answers with its room and its reference for the message.", "inputType": "CmChannelMessageReceivedInput", "outputType": "CmChannelMessageReceivedOutput", "reply": "now" },
    { "operationId": "sendChannelMessage", "direction": "serve", "kind": "command", "description": "The cm asks the channel module to send a text to a conversation of the channel, as an answer or at any time.", "inputType": "CmSendChannelMessageInput", "outputType": "CmSendChannelMessageOutput", "reply": "now", "hiddenFromAgents": true },
    { "operationId": "setChannelConversationIdentity", "direction": "serve", "kind": "command", "description": "The cm tells the channel module who the person of a conversation is, or clears it.", "inputType": "CmSetChannelConversationIdentityInput", "outputType": "CmSetChannelConversationIdentityOutput", "reply": "now", "hiddenFromAgents": true },
    { "operationId": "disableChannel", "direction": "serve", "kind": "command", "description": "The cm asks, in an extreme case, to block a conversation or to pause a bot of the channel, with the reason.", "inputType": "CmDisableChannelInput", "outputType": "CmDisableChannelOutput", "reply": "now", "hiddenFromAgents": true },
    { "operationId": "notifyPerson", "direction": "call", "kind": "command", "description": "A module asks the cm to tell a person something: the text and the contact. The cm records it in the room of that person and sends it through a channel. No AI.", "inputType": "CmNotifyPersonInput", "outputType": "CmNotifyPersonOutput", "reply": "now" }
  ]
};

export default cm;
