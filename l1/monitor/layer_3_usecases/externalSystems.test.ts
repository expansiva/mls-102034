/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/externalSystems.test.ts" enhancement="_blank" />
import { isAppAdmin } from '/_102034_/l1/monitor/layer_3_usecases/externalSystems.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { ExternalCallRow } from '/_102034_/l1/server/layer_1_external/connections/external/externalCallStore.js';
import type { ExternalSystemDeclaration } from '/_102034_/l1/server/layer_1_external/connections/external/types.js';
import { monitorExternalSystemsListHandler } from '/_102034_/l1/monitor/layer_2_controllers/externalSystemsHandlers.js';
import {
  externalSystemsOf,
  setExternalSetting,
  type ExternalSystemsDeps,
} from '/_102034_/l1/monitor/layer_3_usecases/externalSystems.js';

const SECRET = 'super-secret-value';

const declaration: ExternalSystemDeclaration = {
  schemaVersion: 'external-system-v1',
  systemId: 'billing',
  title: 'Billing',
  description: 'Test system.',
  hosts: [{ host: 'billing.example' }, { fromSetting: 'apiHost' }, { fromSetting: 'signingKey' }],
  settings: [
    { id: 'apiHost', secret: false },
    { id: 'signingKey', secret: true },
    { id: 'account', secret: false },
  ],
  operations: [
    {
      operationId: 'lookup',
      direction: 'call',
      kind: 'query',
      description: 'Look up.',
      inputType: 'In',
      outputType: 'Out',
      methods: ['GET'],
      uses: { settings: ['account'], secrets: [] },
      reply: 'now',
    },
    {
      operationId: 'receive',
      direction: 'serve',
      kind: 'command',
      description: 'Receive.',
      inputType: 'In',
      outputType: 'Out',
    },
  ],
};

const bare: ExternalSystemDeclaration = {
  ...declaration,
  systemId: 'bare',
  title: 'Bare',
  hosts: [{ host: 'bare.example' }],
  settings: [{ id: 'account', secret: false }],
  operations: [],
};

function row(): ExternalCallRow {
  return {
    id: '1',
    occurredAt: '2026-11-19T00:00:00.000Z',
    direction: 'in',
    projectId: '102047',
    moduleId: 'shop',
    systemId: 'billing',
    operationId: 'receive',
    server: 'billing.example',
    path: '/hook/102047/shop/billing/receive',
    outcome: 'ok',
    denialReason: null,
    httpStatus: 200,
    durationMs: 12,
    bytes: 4,
    actorKind: null,
    actorId: null,
    requestId: null,
  };
}

function deps(): ExternalSystemsDeps & { stored: Map<string, string> } {
  const stored = new Map<string, string>([['billing\0signingKey', SECRET]]);
  return {
    stored,
    async systemsOf() {
      return new Map([['billing', 'shop'], ['bare', 'shop'], ['other', 'other']]);
    },
    async declarationOf(ref) {
      if (ref.systemId === 'billing') return declaration;
      if (ref.systemId === 'bare') return bare;
      return null;
    },
    settings: {
      async status(_projectId, systemId) {
        const source = systemId === 'billing' ? declaration : bare;
        return source.settings.map((item) => ({
          settingId: item.id,
          filled: stored.has(`${systemId}\0${item.id}`),
        }));
      },
      async settingOf(ref, settingId) {
        const source = ref.systemId === 'billing' ? declaration : bare;
        const item = source.settings.find((entry) => entry.id === settingId);
        if (!item || item.secret) return undefined;
        return stored.get(`${ref.systemId}\0${settingId}`);
      },
      async set(ref, settingId, value) {
        const source = ref.systemId === 'billing' ? declaration : bare;
        if (!source.settings.some((item) => item.id === settingId)) return { ok: false, code: 'refused' };
        stored.set(`${ref.systemId}\0${settingId}`, value);
        return { ok: true };
      },
    },
    async recentCalls() {
      return [row()];
    },
    writeFailureCount: () => 3,
    publicOrigin: () => 'https://app.example',
  };
}

test('a secret never appears in the monitor view, and an empty setting is missing', async () => {
  const view = await externalSystemsOf(deps(), '102047', 'shop');
  const packed = JSON.stringify(view);
  assert.equal(packed.includes(SECRET), false);
  const billing = view.systems.find((item) => item.systemId === 'billing');
  assert.ok(billing);
  assert.equal(billing.settings.find((item) => item.settingId === 'signingKey')?.status, 'filled');
  assert.equal(billing.settings.find((item) => item.settingId === 'account')?.status, 'missing');
  assert.equal(billing.hosts.find((item) => item.fromSetting === 'signingKey')?.value, undefined);
  assert.equal(billing.operations.find((item) => item.operationId === 'receive')?.hook, 'https://app.example/hook/102047/shop/billing/receive');
  assert.equal(billing.recent.length, 1);
  assert.equal(billing.writeFailureCount, 3);
  const bareSystem = view.systems.find((item) => item.systemId === 'bare');
  assert.equal(bareSystem?.settings[0]?.status, 'missing');
  assert.equal(view.systems.some((item) => item.systemId === 'other'), false);
});

test('setExternalSetting does not return the value', async () => {
  const gate = deps();
  const written = await setExternalSetting(gate, { projectId: '102047', moduleId: 'shop', systemId: 'billing' }, 'signingKey', SECRET, 'ada');
  assert.deepEqual(written, { ok: true });
  assert.equal(JSON.stringify(written).includes(SECRET), false);
});

test('a caller who is not an app admin gets 403', async () => {
  await assert.rejects(
    () => monitorExternalSystemsListHandler({
      request: {
        routine: 'monitor.externalSystems.list',
        params: { projectId: '102047', moduleId: 'shop' },
        meta: { verifiedUserId: 'u1', verifiedAuthorities: ['shop:clerk'] },
      },
      ctx: {} as never,
    }),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );
});

test('only monitor:admin or sites:admin is an app admin; the admin of another module is not', () => {
  assert.equal(isAppAdmin(['monitor:admin']), true);
  assert.equal(isAppAdmin(['sites:admin']), true);
  assert.equal(isAppAdmin(['shop:admin']), false);
  assert.equal(isAppAdmin(['petShop:admin', 'shop:clerk']), false);
  assert.equal(isAppAdmin(undefined), false);
});
