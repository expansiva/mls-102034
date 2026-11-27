/**
 * TEST SUPPORT of the outside-system door. It lives OUTSIDE `l1`, `l2` and `l4`, so nothing here reaches a release.
 * How and the module tests use it to prove an adapter without a network:
 *
 *   import { exampleExternalSystem, exampleExternalAdapter, createFakeAdapterContext, createFakeExternalSender } from '/_102034_/testing/connections/externalFixtures.js';
 */
import type { ConnectionContext } from '/_102034_/l2/shared/contracts/connections/types.js';
import {
  createExternalSender,
  type ExternalRecordEvent,
  type ExternalRef,
  type ExternalSender,
  type ExternalTransportCall,
  type ExternalTransportResponse,
} from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';
import type {
  ExternalAdapterContext,
  ExternalSystemAdapter,
  ExternalSystemDeclaration,
} from '/_102034_/l2/shared/contracts/connections/externalSystem.js';

export interface ExampleLookupInput { key: string }
export interface ExampleLookupOutput { value: string }
export interface ExampleNotifyInput { to: string; text: string }
export interface ExampleNotifyOutput { sent: boolean }
export interface ExampleReceiveInput { id: string }
export interface ExampleReceiveOutput { received: boolean }

/** One `call` query, one `call` command and one `serve` with `verify`: what a test of the adapter needs. */
export const exampleExternalSystem: ExternalSystemDeclaration = {
  schemaVersion: 'external-system-v1',
  systemId: 'example',
  title: 'Example',
  description: 'A declaration for tests only.',
  hosts: [{ host: 'example.test' }],
  settings: [
    { id: 'account', secret: false },
    { id: 'signingKey', secret: true },
  ],
  operations: [
    {
      operationId: 'lookup',
      direction: 'call',
      kind: 'query',
      description: 'Look a value up.',
      inputType: 'ExampleLookupInput',
      outputType: 'ExampleLookupOutput',
      methods: ['GET'],
      uses: { settings: ['account'], secrets: [] },
      reply: 'now',
    },
    {
      operationId: 'notify',
      direction: 'call',
      kind: 'command',
      description: 'Send a notice.',
      inputType: 'ExampleNotifyInput',
      outputType: 'ExampleNotifyOutput',
      methods: ['POST'],
      uses: { settings: [], secrets: ['signingKey'] },
      reply: 'now',
    },
    {
      operationId: 'receive',
      direction: 'serve',
      kind: 'command',
      description: 'The outside system hands something to the module.',
      inputType: 'ExampleReceiveInput',
      outputType: 'ExampleReceiveOutput',
      verify: {
        scheme: 'hmac',
        algorithm: 'sha256',
        secret: 'signingKey',
        signature: { header: 'x-signature', encoding: 'hex' },
        signed: ['body'],
      },
    },
  ],
};

/** Written the way a generated adapter is written: one function per `call`, `serve` stays out. */
export const exampleExternalAdapter: ExternalSystemAdapter = {
  async lookup(input, ctx) {
    const typed = input as ExampleLookupInput;
    const account = ctx.setting('account') ?? '';
    const result = await ctx.send('lookup', {
      method: 'GET',
      path: '/lookup',
      query: { key: typed.key, account },
    });
    if (!result.ok) return result;
    const parsed = JSON.parse(result.output.body) as ExampleLookupOutput;
    return { ok: true, output: parsed };
  },
  async notify(input, ctx) {
    const typed = input as ExampleNotifyInput;
    const result = await ctx.send('notify', {
      method: 'POST',
      path: '/notify',
      headers: { authorization: 'Bearer {{secret:signingKey}}' },
      body: JSON.stringify({ to: typed.to, text: typed.text }),
    });
    if (!result.ok) return result;
    return { ok: true, output: { sent: true } satisfies ExampleNotifyOutput };
  },
};

const PUBLIC_ADDRESS = '8.8.8.8';

export interface FakeTransport {
  transport(call: ExternalTransportCall): Promise<ExternalTransportResponse>;
  /** Calls as the sender handed them to the transport, in order. */
  readonly calls: ExternalTransportCall[];
}

/** A transport that answers by exact URL (`https://host/path?query`). An unknown URL is HTTP 404. */
export function createFakeTransport(answers: Readonly<Record<string, ExternalTransportResponse>>): FakeTransport {
  const calls: ExternalTransportCall[] = [];
  return {
    calls,
    async transport(call) {
      calls.push(call);
      return answers[call.url] ?? { status: 404, headers: {}, body: '' };
    },
  };
}

/** DNS for tests. A host without an entry resolves to one public address. */
export function createFakeHostResolver(addresses: Readonly<Record<string, readonly string[]>> = {}): (host: string) => Promise<string[]> {
  return async (host) => [...(addresses[host] ?? [PUBLIC_ADDRESS])];
}

export interface FakeExternalCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FakeExternalSender extends ExternalSender {
  /** Requests the sender accepted, with every known secret already replaced by `***`. */
  readonly calls: FakeExternalCall[];
  readonly records: ExternalRecordEvent[];
}

export interface FakeExternalSenderOptions {
  /** Keyed by the full URL the sender builds (`https://<host><path>` plus query). */
  answers: Readonly<Record<string, ExternalTransportResponse>>;
  declaration?: ExternalSystemDeclaration;
  settings?: Readonly<Record<string, string | null>>;
  secrets?: Readonly<Record<string, string | null>>;
  /** Host to addresses. Missing hosts resolve to one public address. */
  addresses?: Readonly<Record<string, readonly string[]>>;
  ref?: ExternalRef;
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * The same door as `createExternalSender`: declaration, method, host, secret citation, blocked address,
 * timeout and size are refused by that function. This only supplies the ports and records the call.
 */
export function createFakeExternalSender(options: FakeExternalSenderOptions): FakeExternalSender {
  const declaration = options.declaration ?? exampleExternalSystem;
  const settings = options.settings ?? {};
  const secrets = options.secrets ?? {};
  const knownSecrets = Object.values(secrets).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const transport = createFakeTransport(options.answers);
  const records: ExternalRecordEvent[] = [];
  const refDefault: ExternalRef = options.ref ?? { projectId: 'p', moduleId: 'module', systemId: declaration.systemId };
  const sender = createExternalSender({
    declarationOf(ref) {
      return ref.systemId === declaration.systemId ? declaration : null;
    },
    settingOf(_ref, settingId) {
      return settings[settingId] ?? null;
    },
    secretOf(_ref, settingId) {
      return secrets[settingId] ?? null;
    },
    record(event) {
      records.push(event);
    },
    transport: transport.transport,
    resolveHost: createFakeHostResolver(options.addresses),
  });
  const calls: FakeExternalCall[] = [];
  const fake: FakeExternalSender = {
    calls,
    records,
    async sendExternal(ref, operationId, request, context) {
      const before = transport.calls.length;
      const result = await sender.sendExternal(ref ?? refDefault, operationId, request, context);
      const seen = transport.calls[before];
      if (seen) {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(seen.headers)) headers[name] = redact(value, knownSecrets);
        calls.push({
          url: seen.url,
          method: seen.method,
          headers,
          body: seen.body === undefined ? undefined : redact(seen.body, knownSecrets),
        });
      }
      return result;
    },
  };
  return fake;
}

export interface FakeAdapterContextOptions {
  connection?: ConnectionContext;
  /** Non-secret settings. A secret id returns `undefined`. */
  settings?: Readonly<Record<string, string>>;
  secrets?: readonly string[];
  sender?: ExternalSender;
  ref?: ExternalRef;
  /** The public address of a `serve` operation, by operationId. An operation not listed has none. */
  hookUrls?: Readonly<Record<string, string>>;
}

/** A context for a generated adapter. `send` is the fake door; `setting` never returns a secret. */
export function createFakeAdapterContext(options: FakeAdapterContextOptions = {}): ExternalAdapterContext {
  const connection: ConnectionContext = options.connection ?? { organizationId: 'org' };
  const ref = options.ref ?? { projectId: 'p', moduleId: 'module', systemId: exampleExternalSystem.systemId };
  const sender = options.sender ?? createFakeExternalSender({ answers: {}, ref });
  const hidden = new Set(options.secrets ?? ['signingKey']);
  return {
    connection,
    hookUrl: (operationId) => options.hookUrls?.[operationId],
    send(operationId, request) {
      return sender.sendExternal(ref, operationId, request, connection);
    },
    setting(settingId) {
      if (hidden.has(settingId)) return undefined;
      return options.settings?.[settingId];
    },
  };
}
