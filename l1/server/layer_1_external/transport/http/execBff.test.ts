/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/execBff.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { getFrontendAppRegistrations } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';
import { resolveActivePublicationDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { handleHttpRequest } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { execMessage } from '/_102034_/l1/server/layer_1_external/transport/message/execMessage.js';
import { createRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { getModuleBffRegistrations, loadModuleRouter, resetModuleRouterCache } from '/_102034_/l1/server/layer_2_controllers/moduleRegistry.js';
import { resetSharedBffExecutionSeriesStore } from '/_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.js';

test.beforeEach(() => {
  process.env.APP_ENV = 'development';
  process.env.RUNTIME_MODE = 'memory';
  process.env.WRITE_BEHIND_ENABLED = 'false';
  delete process.env.ACTIVE_COMPANY_ID;
  delete process.env.ACTIVE_UNIT_ID;
  delete process.env.CURRENT_WORKSPACE_ID;
  delete process.env.ACTOR_ID;
  delete process.env.ACTOR_SCOPE;
  delete process.env.PROJECT_ID;
  delete process.env.PROJECT_DOMAIN;
  delete process.env.STUDIO_ENABLED;
  resetSharedBffExecutionSeriesStore();
  resetModuleRouterCache();
});

test('POST /execBff executes routine and returns response envelope', async () => {
  const ctx = createRequestContext();
  const response = await handleHttpRequest('POST', '/execBff', {
    routine: 'mdm.entity.create',
    params: {
      detail: {
        subtype: 'Company',
        name: 'HTTP Corp',
        legalName: 'HTTP Corporation',
        status: 'Active',
      },
    },
  }, ctx);
  const body = response.body as { ok: boolean; data?: { mdmId: string } };

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  if (!body.ok || !body.data) {
    throw new Error('Expected ok response');
  }
  assert.equal(typeof body.data.mdmId, 'string');
});

test('GET /health returns ok response', async () => {
  const response = await handleHttpRequest('GET', '/health');
  const body = response.body as { ok: boolean };

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, { ok: true });
});

test('createRequestContext maps runtime businessContext into sessionContext', () => {
  process.env.ACTIVE_COMPANY_ID = 'company-001';
  process.env.ACTIVE_UNIT_ID = 'unit-002';
  process.env.CURRENT_WORKSPACE_ID = 'workspace-pos';
  process.env.ACTOR_ID = 'manager';
  process.env.ACTOR_SCOPE = 'cafeFlow:manager,cafeFlow:owner';
  process.env.PROJECT_ID = '102050';
  process.env.PROJECT_DOMAIN = '102050.collab.codes';
  process.env.STUDIO_ENABLED = 'true';

  const ctx = createRequestContext();

  assert.equal(ctx.sessionContext.activeCompanyId, 'company-001');
  assert.equal(ctx.sessionContext.businessContext.activeCompanyId, 'company-001');
  assert.equal(ctx.sessionContext.activeUnitId, 'unit-002');
  assert.equal(ctx.sessionContext.currentWorkspace.workspaceId, 'workspace-pos');
  assert.equal(ctx.sessionContext.actorSession.actorId, 'manager');
  assert.deepEqual(ctx.sessionContext.actorSession.scope, ['cafeFlow:manager', 'cafeFlow:owner']);
  assert.equal(ctx.sessionContext.project.projectId, '102050');
  assert.equal(ctx.sessionContext.project.domain, '102050.collab.codes');
  assert.equal(ctx.sessionContext.project.studioEnabled, true);
});

test('GET /index.html of a configured frontend app serves the registered frontend html', async () => {
  const apps = await getFrontendAppRegistrations();
  const sampleApp = apps.find((app) => app.projectId !== '102034' && app.projectId !== '102033') ?? apps[0];
  if (!sampleApp) {
    throw new Error('Expected at least one frontend app registration');
  }

  const response = await handleHttpRequest('GET', `${sampleApp.basePath}/index.html`);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['content-type'], 'text/html; charset=utf-8');
  assert.equal(Buffer.isBuffer(response.body), true);
  assert.equal((response.body as Buffer).toString('utf8').includes('Collab Aura SPA'), true);
  assert.equal((response.body as Buffer).toString('utf8').includes('"routes":['), true);
});

test('GET nested path of a configured SPA app falls back to the entry html', async () => {
  const apps = await getFrontendAppRegistrations();
  const sampleApp = apps.find((app) => app.projectId !== '102034' && app.projectId !== '102033') ?? apps[0];
  if (!sampleApp) {
    throw new Error('Expected at least one frontend app registration');
  }

  const response = await handleHttpRequest('GET', `${sampleApp.basePath}/nested-route`);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['content-type'], 'text/html; charset=utf-8');
});

test('GET project asset path serves compiled l2 modules', async () => {
  const response = await handleHttpRequest('GET', '/_102034_/l2/monitor/web/desktop/page11/home.js');

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['content-type'], 'text/javascript; charset=utf-8');
});

test('GET chunk asset path serves esbuild shared chunks', async () => {
  const chunksDir = resolveActivePublicationDistPath('./_chunks');
  if (!existsSync(chunksDir)) {
    return;
  }

  const chunkName = readdirSync(chunksDir).find((fileName) => fileName.endsWith('.js'));
  if (!chunkName) {
    return;
  }

  const response = await handleHttpRequest('GET', `/_chunks/${chunkName}`);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['content-type'], 'text/javascript; charset=utf-8');
});

test('message transport uses the same unified protocol', async () => {
  const ctx = createRequestContext();
  const response = await execMessage({
    routine: 'mdm.entity.create',
    params: {
      detail: {
        subtype: 'ContactChannel',
        name: 'Ops Email',
        status: 'Active',
        contactType: 'Email',
        value: 'ops@example.com',
      },
    },
  }, ctx);

  assert.equal(response.statusCode, 200);
  assert.equal(response.response.ok, true);
});

test('execBff resolves a configured module router', async () => {
  const registration = getModuleBffRegistrations().find((entry) => entry.moduleId === 'monitor');
  assert.equal(!!registration, true);
  if (!registration) {
    throw new Error('Expected configured module registration');
  }

  const router = await loadModuleRouter(registration);

  assert.equal(router.size > 0, true);
});

test('execBff returns MODULE_NOT_REGISTERED for unknown modules', async () => {
  const ctx = createRequestContext();
  const response = await execBff({
    routine: 'billing.listInvoices',
    params: {},
    meta: { source: 'test' },
  }, ctx);

  assert.equal(response.statusCode, 404);
  assert.equal(response.response.ok, false);
  assert.equal(response.response.error?.code, 'MODULE_NOT_REGISTERED');
});

test('module registry returns MODULE_ROUTER_NOT_FOUND when router cannot be loaded', async () => {
  await assert.rejects(
    () => loadModuleRouter({
      projectId: '999999',
      moduleId: 'broken',
      frontendBasePath: '/broken',
      frontendEntrypoint: '/_999999_/l2/broken/index.js',
      loadRouter: async () => {
        throw new Error('missing file');
      },
    }),
    (error: unknown) => {
      if (!(error instanceof Error)) {
        return false;
      }
      return 'code' in error && (error as Error & { code?: string }).code === 'MODULE_ROUTER_NOT_FOUND';
    },
  );
});

test('execBff supports user-like person creation, get and list flow', async () => {
  const ctx = createRequestContext();

  const created = await execBff(
    {
      routine: 'mdm.entity.create',
      params: {
        detail: {
          subtype: 'Person',
          name: 'Carlos Pereira',
          status: 'Active',
          moduleTypes: ['crm.Person'],
          docType: 'CPF',
          docId: '123.456.789-00',
          aliases: ['Carl'],
          contacts: [],
          addresses: [],
          privacyConsent: {
            consentedAt: '2026-03-18T11:00:00.000Z',
            consentVersion: 'v1',
            channel: 'web',
          },
        },
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  assert.equal(created.statusCode, 200);
  assert.equal(created.response.ok, true);
  if (!created.response.ok || !created.response.data) {
    throw new Error('Expected created response');
  }

  const createdData = created.response.data as { mdmId: string };
  const fetched = await execBff(
    {
      routine: 'mdm.entity.get',
      params: {
        mdmId: createdData.mdmId,
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );
  const listed = await execBff(
    {
      routine: 'mdm.entity.list',
      params: {
        type: 'crm.Person',
        subtype: 'Person',
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  assert.equal(fetched.statusCode, 200);
  assert.equal(listed.statusCode, 200);
  if (!fetched.response.ok || !fetched.response.data) {
    throw new Error('Expected fetched response');
  }
  if (!listed.response.ok || !listed.response.data) {
    throw new Error('Expected listed response');
  }

  const fetchedData = fetched.response.data as {
    details: { name: string; docId: string };
  };
  const listedData = listed.response.data as { items: Array<{ mdmId: string; subtype: string }> };

  assert.equal(fetchedData.details.name, 'Carlos Pereira');
  assert.equal(fetchedData.details.docId, '12345678900');
  assert.equal(listedData.items.some((item) => item.mdmId === createdData.mdmId), true);
});

test('execBff list returns created company records by canonical module type', async () => {
  const ctx = createRequestContext();

  await execBff(
    {
      routine: 'mdm.entity.create',
      params: {
        detail: {
          subtype: 'Company',
          name: 'Searchable Labs',
          legalName: 'Searchable Labs LTDA',
          status: 'Active',
          moduleTypes: ['crm.Company'],
          tags: ['innovation'],
        },
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  const searched = await execBff(
    {
      routine: 'mdm.entity.list',
      params: {
        type: 'crm.Company',
        name: 'searchable',
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  assert.equal(searched.statusCode, 200);
  assert.equal(searched.response.ok, true);
  if (!searched.response.ok || !searched.response.data) {
    throw new Error('Expected searched response');
  }

  const data = searched.response.data as {
    items: Array<{ name: string }>;
  };
  assert.equal(data.items.some((item) => item.name === 'Searchable Labs'), true);
});

test('execBff supports tag add and find flow', async () => {
  const ctx = createRequestContext();

  const added = await execBff(
    {
      routine: 'mdm.tag.add',
      params: {
        entityType: 'MdmCompany',
        entityId: 'company-tag-1',
        tag: 'VIP',
        module: 'purchasing',
      },
      meta: {
        source: 'test',
        userId: 'user-tag-1',
      },
    },
    ctx,
  );

  assert.equal(added.statusCode, 200);
  assert.equal(added.response.ok, true);

  const listed = await execBff(
    {
      routine: 'mdm.tag.findByEntity',
      params: {
        entityType: 'MdmCompany',
        entityId: 'company-tag-1',
      },
      meta: {
        source: 'test',
        userId: 'user-tag-1',
      },
    },
    ctx,
  );

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.response.ok, true);
  if (!listed.response.ok || !listed.response.data) {
    throw new Error('Expected tag list response');
  }

  const rows = listed.response.data as Array<{ tag: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.tag, 'vip');
});

test('execBff supports comment and numberSequence flows', async () => {
  const ctx = createRequestContext();

  const comment = await execBff(
    {
      routine: 'mdm.comment.add',
      params: {
        entityType: 'PurchaseOrder',
        entityId: 'po-bff-1',
        text: 'Needs approval',
        module: 'purchasing',
      },
      meta: {
        source: 'test',
        userId: 'user-comment-1',
      },
    },
    ctx,
  );
  const sequence = await execBff(
    {
      routine: 'mdm.numberSequence.next',
      params: {
        sequenceKey: 'purchasing.PurchaseOrder.global',
        prefix: 'PO-',
        scopeType: 'global',
        padding: 3,
      },
      meta: {
        source: 'test',
        userId: 'user-comment-1',
      },
    },
    ctx,
  );

  assert.equal(comment.statusCode, 200);
  assert.equal(sequence.statusCode, 200);
  assert.equal(comment.response.ok, true);
  assert.equal(sequence.response.ok, true);
});

test('execBff blocks legacy public entity merge route', async () => {
  const ctx = createRequestContext();

  const merge = await execBff(
    {
      routine: 'mdm.entity.merge',
      params: {
        winnerMdmId: 'winner',
        loserMdmId: 'loser',
      },
      meta: {
        source: 'test',
        userId: 'user-status-1',
      },
    },
    ctx,
  );

  assert.equal(merge.statusCode, 404);
  assert.equal(merge.response.ok, false);
  assert.equal(merge.response.error?.code, 'ROUTINE_NOT_FOUND');
});

test('monitor snapshot and series BFFs return monitor data', async () => {
  const ctx = createRequestContext();

  await execBff(
    {
      routine: 'mdm.entity.create',
      params: {
        detail: {
          subtype: 'Company',
          name: 'Monitor Labs',
          legalName: 'Monitor Labs LTDA',
          status: 'Active',
        },
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  await execBff(
    {
      routine: 'unknown.page.command',
      params: {},
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  const snapshot = await execBff(
    {
      routine: 'monitor.monitorGetStatistics.getSnapshot',
      params: {},
      meta: {
        source: 'test',
      },
    },
    ctx,
  );
  const series = await execBff(
    {
      routine: 'monitor.monitorGetStatistics.getSeries',
      params: {
        windowSeconds: 10,
      },
      meta: {
        source: 'test',
      },
    },
    ctx,
  );

  assert.equal(snapshot.statusCode, 200);
  assert.equal(series.statusCode, 200);
  assert.equal(snapshot.response.ok, true);
  assert.equal(series.response.ok, true);
  if (!snapshot.response.ok || !snapshot.response.data) {
    throw new Error('Expected snapshot response');
  }
  if (!series.response.ok || !series.response.data) {
    throw new Error('Expected series response');
  }

  const snapshotData = snapshot.response.data as {
    bff: {
      overview: {
        totalExecutions: number;
        successCount: number;
        notFoundCount: number;
      };
    };
  };
  const seriesData = series.response.data as {
    totals: {
      total: number;
      success: number;
      notFound: number;
    };
    series: Array<{ total: number }>;
  };

  assert.equal(snapshotData.bff.overview.totalExecutions >= 2, true);
  assert.equal(snapshotData.bff.overview.successCount >= 1, true);
  assert.equal(snapshotData.bff.overview.notFoundCount >= 1, true);
  assert.equal(seriesData.totals.total >= 2, true);
  assert.equal(seriesData.totals.success >= 1, true);
  assert.equal(seriesData.totals.notFound >= 1, true);
  assert.equal(Array.isArray(seriesData.series), true);
});
