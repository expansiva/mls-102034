/**
 * TEST SUPPORT of the connection layer (rt234 s4). It lives OUTSIDE `l1`, `l2` and `l4`, the only folders the release build
 * takes (`TS_SEGMENTS` of `scripts/build.mjs` plus the emitted L4 defs), so nothing here reaches a release. How, What and the
 * module tests use it to prove a connection without the cm in the air:
 *
 *   import { exampleCatalog, createFakeCallConnection } from '/_102034_/testing/connections/connectionFixtures.js';
 */
import type { CallConnection } from '/_102034_/l1/server/layer_1_external/connections/callConnection.js';
import type { ConnectionCatalog, ConnectionErrorCode, ConnectionResult } from '/_102034_/l4/ontology/connections/types.defs.js';

export interface ExampleLookupInput { key: string }
export interface ExampleLookupOutput { value: string }
export interface ExampleNotifyInput { to: string; text: string }
export interface ExampleNotifyOutput { sent: boolean }
export interface ExampleReceiveInput { id: string }
export interface ExampleReceiveOutput { received: boolean }

/** One `call` query, one `call` command and one `serve` command: what a test of the connector needs. */
export const exampleCatalog: ConnectionCatalog = {
  schemaVersion: 'connection-catalog-v1',
  connectionId: 'example',
  title: 'Example',
  description: 'A catalog for tests only.',
  operations: [
    { operationId: 'lookup', direction: 'call', kind: 'query', description: 'Look a value up.', inputType: 'ExampleLookupInput', outputType: 'ExampleLookupOutput', reply: 'now' },
    { operationId: 'notify', direction: 'call', kind: 'command', description: 'Send a notice.', inputType: 'ExampleNotifyInput', outputType: 'ExampleNotifyOutput', reply: 'now', timeoutMs: 2000 },
    { operationId: 'receive', direction: 'serve', kind: 'command', description: 'The outside system hands something to the module.', inputType: 'ExampleReceiveInput', outputType: 'ExampleReceiveOutput', reply: 'now' },
  ],
};

export const CONNECTION_CODES: readonly ConnectionErrorCode[] = ['not_found', 'disabled', 'unavailable', 'conflict', 'refused', 'forbidden', 'invalid'];

/** What the fake answers for `<connectionId>.<operationId>`: an output, or one of the seven codes. */
export type FakeAnswer = { output: unknown } | { code: ConnectionErrorCode; message?: string };

export interface FakeCallConnection extends CallConnection {
  /** The calls received, in order (the input and the context as they arrived). */
  readonly calls: Array<{ connectionId: string; operationId: string; input: unknown; context: unknown; opts: unknown }>;
}

/** A `callConnection` that answers by table and simulates the seven codes. An operation not in the table is `not_found`. */
export function createFakeCallConnection(table: Readonly<Record<string, FakeAnswer>>): FakeCallConnection {
  const calls: FakeCallConnection['calls'] = [];
  const fake = (async (connectionId, operationId, input, context, opts = {}): Promise<ConnectionResult> => {
    calls.push({ connectionId, operationId, input, context, opts });
    const answer = table[`${connectionId}.${operationId}`];
    if (!answer) return { ok: false, code: 'not_found', message: `${connectionId}.${operationId} is not in the table` };
    if ('output' in answer) return { ok: true, output: answer.output };
    return { ok: false, code: answer.code, message: answer.message ?? answer.code };
  }) as FakeCallConnection;
  Object.defineProperty(fake, 'calls', { value: calls });
  return fake;
}
