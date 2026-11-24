/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/connectionCatalogs.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import cm from '/_102034_/l1/server/layer_1_external/connections/catalogs/cm.js';
import platform from '/_102034_/l1/server/layer_1_external/connections/catalogs/platform.js';
import type { ConnectionCatalog } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../l2/shared/contracts/connections');
const textOf = (name: string): string => readFileSync(path.join(FOLDER, name), 'utf8');

/** `conexoes.md` §5: operation, direction, kind, reply. */
const CM_TABLE: Array<[string, 'call' | 'serve', 'query' | 'command', 'now' | 'later']> = [
  ['listAgents', 'call', 'query', 'now'],
  ['readAgent', 'call', 'query', 'now'],
  ['updateAgent', 'call', 'command', 'now'],
  ['listAgentHistory', 'call', 'query', 'now'],
  ['undoAgentChange', 'call', 'command', 'now'],
  ['simulateAgent', 'call', 'command', 'now'],
  ['createAgent', 'call', 'command', 'later'],
  ['activateAgent', 'call', 'command', 'now'],
  ['discardAgentDraft', 'call', 'command', 'now'],
  ['listCmTools', 'call', 'query', 'now'],
  ['runAiPrompt', 'call', 'command', 'now'],
  ['agentDraftReady', 'serve', 'command', 'now'],
  ['describe', 'serve', 'query', 'now'],
  ['ensureAgentMember', 'serve', 'command', 'now'],
  ['record', 'serve', 'command', 'now'],
];

function check(catalog: ConnectionCatalog, file: string): void {
  assert.equal(catalog.schemaVersion, 'connection-catalog-v1');
  assert.ok(catalog.title && catalog.description);
  const ids = catalog.operations.map((operation) => operation.operationId);
  assert.equal(new Set(ids).size, ids.length, 'operation ids are unique in the connection');
  const source = textOf(file);
  for (const operation of catalog.operations) {
    assert.match(operation.operationId, /^[a-z][A-Za-z0-9]*$/, `${operation.operationId} is lowerCamel`);
    assert.ok(operation.description.length > 0);
    for (const typeName of [operation.inputType, operation.outputType]) {
      assert.match(source, new RegExp(`export (interface|type) ${typeName}\\b`), `${typeName} is exported in ${file}`);
    }
    if (operation.reply === 'later') {
      const result = catalog.operations.find((other) => other.operationId === operation.resultOperation);
      assert.equal(result?.direction, 'serve', `${operation.operationId}: resultOperation is a serve operation`);
      assert.equal(operation.direction, 'call');
    } else {
      assert.equal(operation.resultOperation, undefined);
    }
    if (operation.hiddenFromAgents || operation.noRowLimit) assert.equal(operation.direction, 'serve');
    if (operation.noRowLimit) assert.equal(operation.kind, 'query');
  }
}

test('the cm catalog has the 15 operations of the contract, with direction, kind and reply', () => {
  assert.equal(cm.connectionId, 'cm');
  assert.deepEqual(cm.operations.map((operation) => [operation.operationId, operation.direction, operation.kind, operation.reply]), CM_TABLE);
  check(cm, 'cm.ts');
});

test('the cm marks what the contract marks: describe and record hidden, describe without row ceiling, createAgent answers later, runAiPrompt waits longer', () => {
  const byId = new Map(cm.operations.map((operation) => [operation.operationId, operation]));
  assert.equal(byId.get('describe')?.hiddenFromAgents, true);
  assert.equal(byId.get('describe')?.noRowLimit, true);
  assert.equal(byId.get('record')?.hiddenFromAgents, true);
  assert.equal(byId.get('record')?.noRowLimit, undefined);
  assert.equal(byId.get('createAgent')?.resultOperation, 'agentDraftReady');
  assert.equal(byId.get('runAiPrompt')?.timeoutMs, 630000);
  assert.equal(cm.operations.filter((operation) => operation.timeoutMs !== undefined && operation.operationId !== 'runAiPrompt').length, 0);
  assert.equal(cm.operations.filter((operation) => operation.hiddenFromAgents).length, 3);
});

test('the only operation answered by the platform is ensureAgentMember, hidden from the agents', () => {
  const platformServed = cm.operations.filter((operation) => operation.servedBy === 'platform');
  assert.deepEqual(platformServed.map((operation) => operation.operationId), ['ensureAgentMember']);
  assert.equal(platformServed[0]?.direction, 'serve');
  assert.equal(platformServed[0]?.hiddenFromAgents, true);
  const source = textOf('cm.ts');
  assert.match(/export interface CmEnsureAgentMemberInput \{([^}]+)\}/.exec(source)?.[1] ?? '', /agentId: string;[\s\S]*name: string;[\s\S]*active: boolean;/);
  assert.match(/export interface CmEnsureAgentMemberOutput \{([^}]+)\}/.exec(source)?.[1] ?? '', /mdmId: string;/);
  assert.match(/export interface CmReadAgentOutput \{([^}]+)\}/.exec(source)?.[1] ?? '', /mdmId\?: string;/);
});

test('describe takes the authorities and the snapshot of the person, so the allowed actions can be computed', () => {
  const source = textOf('cm.ts');
  const body = /export interface CmDescribeInput \{([^}]+)\}/.exec(source)?.[1] ?? '';
  assert.match(body, /agentId: string;/);
  assert.match(body, /knownVersion\?: string;/);
  assert.match(body, /authorities: string\[\];/);
  assert.match(body, /snapshotAt: string;/);
});

test('the decisions of the manager and of the cm are in the types', () => {
  const source = textOf('cm.ts');
  assert.match(source, /export interface CmTool \{[^}]*entry: AssistantCatalogItem;/s);
  assert.doesNotMatch(/export interface CmTool \{[^}]*\}/s.exec(source)?.[0] ?? '', /\binputs\??:/);
  for (const field of ['moduleTitle?: string;', 'subject: string;', 'subjectTitle?: string;', 'title?: string;']) {
    assert.ok((/export interface CmTool \{[^}]*\}/s.exec(source)?.[0] ?? '').includes(field), field);
  }
  assert.deepEqual(cm.operations.find((operation) => operation.operationId === 'simulateAgent')?.personInputs, [{ from: 'asMdmId', to: 'as' }]);
  assert.equal(cm.operations.filter((operation) => operation.personInputs !== undefined).length, 2);
  assert.match(source, /personal\?: \{ role: string; state: string \};/);
  assert.match(source, /scope\?: 'company' \| 'personal';/);
  assert.match(source, /refusedReason\?: string;/);
  assert.match(source, /export interface CmAgentLimit \{[^}]*label: string;[^}]*kind: 'number' \| 'text' \| 'boolean';/s);
  assert.match(textOf('types.ts'), /actorMdmId\?: string;/);
});

test('expectsVersion is on exactly updateAgent, undoAgentChange and activateAgent, and on no other operation of any catalog', () => {
  const marked = (catalog: ConnectionCatalog): string[] => catalog.operations.filter((operation) => operation.expectsVersion !== undefined).map((operation) => operation.operationId);
  assert.deepEqual(marked(cm), ['updateAgent', 'undoAgentChange', 'activateAgent']);
  assert.ok(cm.operations.filter((operation) => operation.expectsVersion !== undefined).every((operation) => operation.expectsVersion === true && operation.direction === 'call' && operation.kind === 'command'));
  assert.deepEqual(marked(platform), []);
  assert.match(textOf('types.ts'), /expectsVersion\?: true;/);
});

test('the platform catalog has releaseCatalogChanged as a hidden serve command', () => {
  assert.equal(platform.connectionId, 'platform');
  assert.deepEqual(platform.operations.map((operation) => [operation.operationId, operation.direction, operation.kind, operation.hiddenFromAgents]), [['releaseCatalogChanged', 'serve', 'command', true]]);
  check(platform, 'platform.ts');
});

test('the seven error codes are exactly the ones of the contract', () => {
  const source = textOf('types.ts');
  const declared = /export type ConnectionErrorCode =([^;]+);/.exec(source)?.[1].match(/'([a-z_]+)'/g)?.map((item) => item.slice(1, -1));
  assert.deepEqual(declared, ['not_found', 'disabled', 'unavailable', 'conflict', 'refused', 'forbidden', 'invalid']);
});

test('the catalog files carry no code to run: no import of a value, no call', () => {
  for (const file of ['cm.ts', 'platform.ts', 'types.ts']) {
    const source = textOf(file);
    for (const line of source.split('\n').filter((item) => item.startsWith('import '))) assert.match(line, /^import type /);
  }
});
