/// <mls fileReference="_102034_/l1/monitor/layer_3_usecases/testsMdmAnchors.test.ts" enhancement="_blank" />
// rt126 s2 — the run's organization Company and the MDM anchors, both inside the run's own sandbox runtime.
// The Company comes from the platform's ensureOrganizationIdentity against that runtime (never the process
// initializer nor the process-wide Company id); anchors come from the MDM rows actually loaded there, by
// their `<module>.<Entity>` tags, qualified by module, without any prior HTTP read.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  harvestMdmAnchors,
  organizationNote,
  prepareRunOrganization,
  resolveActorSession,
  type RunOrganization,
  type RunOrganizationSource,
} from '/_102034_/l1/monitor/layer_3_usecases/testsUsecases.js';
import { createRequestContext } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { createMemoryDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/memory/MdmDataRuntimeMemory.js';
import { getSharedDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/runtimeFactory.js';
import { getResolvedOrganizationCompanyId, organizationReservationKey } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { readRegistrationStore } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import { resetProjectsConfigCache } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { resetResolvedTableDefinitionsCache } from '/_102034_/l1/server/layer_1_external/persistence/registry.js';
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';
import type { MdmEntityIndexRecord } from '/_102034_/l1/mdm/module.js';

const NOW = '2026-10-22T00:00:00.000Z';
const BINDING = { key: 'org:rt126-s2', name: 'rt126 s2 org', source: 'project-file' as const };
const previousCwd = process.cwd();
const workspace = mkdtempSync(join(tmpdir(), 'rt126-s2-'));

before(() => {
  symlinkSync(fileURLToPath(new URL('../../..', import.meta.url)), join(workspace, 'mls-102034'));
  writeFileSync(join(workspace, 'config.json'), JSON.stringify({
    defaultProjectId: '102099',
    projects: {
      '102099': {
        root: './client',
        type: 'client',
        persistenceModules: [{ moduleId: 'mdm', persistenceEntrypoint: './_102034_/l1/mdm/persistence.js' }],
      },
      '102029': { root: './fe', type: 'master frontend' },
      '102034': { root: './be', type: 'master backend' },
    },
  }));
  process.chdir(workspace);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
});

after(() => {
  process.chdir(previousCwd);
  resetProjectsConfigCache();
  resetResolvedTableDefinitionsCache();
  rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.ACTOR_ID;
  delete process.env.ACTOR_SCOPE;
  delete process.env.ACTIVE_COMPANY_ID;
});

const source = (companyTags: string[] = ['rt126Mod.OrgCompany']) => (): RunOrganizationSource => ({ binding: BINDING, companyTags });

async function seedMdm(
  data: IDataRuntime,
  mdmId: string,
  tags: string[],
  subtype: 'Person' | 'Company' = 'Person',
  namespace?: Record<string, unknown>,
): Promise<void> {
  const row: MdmEntityIndexRecord = {
    mdmId, subtype, name: `name ${mdmId}`, status: 'Active', countryCode: 'BR', tags,
    searchVector: '', dynamoPk: mdmId, createdAt: NOW, updatedAt: NOW,
  };
  await data.mdmEntityIndex.insert({ record: row });
  const common = { name: row.name, status: 'Active' as const, countryCode: 'BR', tags, aliases: [], contacts: [], relationshipRefs: {}, addresses: [] };
  await data.mdmDocument.put({
    record: {
      mdmId,
      version: 3,
      details: subtype === 'Person'
        ? { ...common, subtype: 'Person', ...(namespace ? { rt126Mod: namespace } : {}) }
        : { ...common, subtype: 'Company', companyKind: 'LegalEntity' },
    },
  });
}

async function companiesIn(data: IDataRuntime): Promise<string[]> {
  return (await data.mdmEntityIndex.findMany({ where: {} })).filter(row => row.subtype === 'Company').map(row => row.mdmId);
}

/** Records which store tables a call touched — the sandbox is the only one handed to the code under test. */
function spyRuntime(data: IDataRuntime, touched: Set<string>): IDataRuntime {
  return new Proxy(data, {
    get(target, property, receiver) {
      if (typeof property === 'string') touched.add(property);
      return Reflect.get(target, property, receiver);
    },
  });
}

test('Company of the run: distinct from the actor Person, equal to the session activeCompanyId', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedMdm(data, 'rt126-owner', ['rt126Mod.Person', 'rt126Mod', 'actor', 'owner']);
  const org = await prepareRunOrganization(data, source());
  assert.ok(org.ok);
  const actor = await resolveActorSession(data, { moduleId: 'rt126Id', moduleName: 'rt126Mod', actorRef: 'owner' });
  assert.ok(actor.ok);
  assert.notEqual(org.companyMdmId, actor.sessionContext.actorId);
  const ctx = createRequestContext(data, { sandbox: true, sessionContext: { ...actor.sessionContext, activeCompanyId: org.companyMdmId } });
  assert.equal(ctx.sessionContext.activeCompanyId, org.companyMdmId);
  assert.equal(ctx.sessionContext.actorId, 'rt126-owner');
  assert.deepEqual(await companiesIn(data), [org.companyMdmId]);
});

test('two runs are isolated; the bootstrap is idempotent inside one run', async () => {
  const first = createMemoryDataRuntime({ sandbox: true });
  const second = createMemoryDataRuntime({ sandbox: true });
  const a = await prepareRunOrganization(first, source());
  const again = await prepareRunOrganization(first, source());
  assert.ok(a.ok && again.ok);
  assert.equal(again.companyMdmId, a.companyMdmId);
  assert.deepEqual(await companiesIn(first), [a.companyMdmId]);

  const ctxB = createRequestContext(second, { sandbox: true });
  assert.equal(await readRegistrationStore(ctxB, organizationReservationKey(BINDING.key)), null, 'run B sees no reservation of run A');
  const b = await prepareRunOrganization(second, source());
  assert.ok(b.ok);
  assert.notEqual(b.companyMdmId, a.companyMdmId);
  assert.deepEqual(await companiesIn(second), [b.companyMdmId]);
});

test('anchors Person/role/Company come from the sandbox rows, qualified by module, with no HTTP read', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedMdm(data, 'rt126-person-a', ['rt126Mod.Person', 'rt126Mod', 'actor', 'owner', 'rt126Mod.Member'], 'Person', { memberCode: 'A-1' });
  await seedMdm(data, 'rt126-person-b', ['rt126Mod', 'actor', 'member', 'rt126Mod.Member'], 'Person', { memberCode: 'B-1' });
  // A Person wrongly tagged as the company role, and a stray Company row: neither may become the Company anchor.
  await seedMdm(data, 'rt126-fake-company', ['rt126Mod.OrgCompany', 'rt126Mod.Company']);
  await seedMdm(data, 'rt126-stray-company', ['rt126Mod.Company'], 'Company');
  await seedMdm(data, 'rt126-other-module', ['otherMod.Person']);
  const org = await prepareRunOrganization(data, source());
  assert.ok(org.ok);

  const pool: Record<string, unknown> = { 'rt126Id.Member.memberId': 'seeded-by-seedIds' };
  await harvestMdmAnchors(pool, data, {
    moduleIdByName: new Map([['rt126Mod', 'rt126Id']]),
    organization: org,
    namedIds: { memberB: 'rt126-person-b' },
  });

  // Person: the only row tagged Person; the role entity prefers the named seedId (B) — A and B stay apart.
  assert.equal(pool['rt126Id.Person.mdmId'], 'rt126-person-a');
  assert.equal(pool['rt126Id.Person.personId'], 'rt126-person-a');
  assert.equal(pool['rt126Id.Person.version'], 3);
  assert.equal(pool['rt126Id.Person.memberCode'], 'A-1');
  assert.equal(pool['rt126Id.Member.mdmId'], 'rt126-person-b');
  assert.equal(pool['rt126Id.Member.memberCode'], 'B-1');
  assert.equal(pool['rt126Id.Member.memberId'], 'seeded-by-seedIds', 'an existing anchor is never overwritten');
  // Company subtype and the configured company role: the run's organization Company only.
  assert.equal(pool['rt126Id.Company.mdmId'], org.companyMdmId);
  assert.equal(pool['rt126Id.Company.companyId'], org.companyMdmId);
  assert.equal(pool['rt126Id.OrgCompany.orgCompanyId'], org.companyMdmId);
  assert.equal(pool['rt126Id.OrgCompany.name'], BINDING.name);
  // No unqualified id, no module outside the run, no alias for an entity that has no MDM origin.
  assert.equal(pool.mdmId, undefined);
  assert.equal(pool['Person.mdmId'], undefined);
  assert.equal(Object.keys(pool).some(key => key.startsWith('otherMod') || key.includes('.Order.')), false);
  assert.equal(Object.values(pool).includes('rt126-stray-company'), false);
  assert.equal(Object.values(pool).includes('rt126-fake-company'), false);
});

test('without a binding: no Company is invented, the dependent case says why, the others are untouched', async () => {
  const data = createMemoryDataRuntime({ sandbox: true });
  await seedMdm(data, 'rt126-person', ['rt126Mod.Person', 'rt126Mod', 'actor', 'owner']);
  const org: RunOrganization = await prepareRunOrganization(data, () => ({ binding: null, companyTags: ['rt126Mod.OrgCompany'] }));
  assert.equal(org.ok, false);
  assert.deepEqual(await companiesIn(data), []);

  const pool: Record<string, unknown> = {};
  await harvestMdmAnchors(pool, data, { moduleIdByName: new Map([['rt126Mod', 'rt126Id']]), organization: org });
  assert.equal(pool['rt126Id.Person.mdmId'], 'rt126-person', 'the Person identity is not blocked by the missing organization');
  assert.equal(Object.keys(pool).some(key => key.includes('.Company.') || key.includes('.OrgCompany.')), false);

  assert.match(organizationNote(['companyId'], { companyId: 'OrgCompany.orgCompanyId' }, org), /no organization binding/u);
  assert.equal(organizationNote(['taskId'], { taskId: 'Task.taskId' }, org), '');

  const thrown = await prepareRunOrganization(data, () => { throw new Error('project file is absent'); });
  assert.ok(!thrown.ok && /project file is absent/u.test(thrown.reason));
});

test('spy: only the run sandbox is touched and the process-wide Company id is never set', async () => {
  const before = getResolvedOrganizationCompanyId();
  // The process store (memory under test): a fallback to it would leave the Company or the reservation there.
  const processStore = getSharedDataRuntime();
  const sandbox = createMemoryDataRuntime({ sandbox: true });
  const touched = new Set<string>();
  const spied = spyRuntime(sandbox, touched);
  const org = await prepareRunOrganization(spied, source());
  assert.ok(org.ok);
  await harvestMdmAnchors({}, spied, { moduleIdByName: new Map([['rt126Mod', 'rt126Id']]), organization: org });

  assert.equal(getResolvedOrganizationCompanyId(), before);
  assert.equal(getResolvedOrganizationCompanyId(), undefined);
  assert.ok(touched.has('runInTransaction') && touched.has('mdmEntityIndex'));
  assert.deepEqual(await companiesIn(processStore), [], 'the process store gets no Company');
  assert.equal(await readRegistrationStore(createRequestContext(processStore), organizationReservationKey(BINDING.key)), null, 'nor the reservation');
  assert.deepEqual(await companiesIn(sandbox), [org.companyMdmId]);
});
