/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftDirOf } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import { writeDraftData } from '/_102034_/l1/server/layer_1_external/cbe/draftDataSource.js';
import { desenvIo, runDraftEnter } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import {
  DraftLoginCopyError,
  copyDraftLogin,
  draftLoginCopyText,
  ensureDraftLoginCopied,
  forgetDraftLoginAbsent,
  forgetDraftLoginCopy,
  planDraftLoginCopy,
  writeDraftLoginPlan,
  type DraftLoginDocumentRow,
  type DraftLoginIndexRow,
  type DraftLoginLoaded,
  type DraftLoginPlan,
  type DraftLoginRelationshipRow,
  type DraftLoginTagRow,
  type Sql,
} from '/_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.js';

const EMAIL = 'ada@example.com';
const PERSON = 'person-1';
const PROD_COMPANY = 'prod-co';
const BOOT_COMPANY = 'boot-co';
const PARTNER = 'partner-1';
const PLACE = 'place-1';

function index(mdmId: string, subtype: string, name: string): DraftLoginIndexRow {
  return {
    mdmId,
    subtype,
    name,
    status: 'Active',
    docType: null,
    docId: null,
    countryCode: 'BR',
    tags: [],
    searchVector: '',
    mergedInto: null,
    dynamoPk: mdmId,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
}

function document(mdmId: string, name: string, version = 1): DraftLoginDocumentRow {
  return { mdmId, version, details: { subtype: 'Person', name } };
}

function relationship(id: string, fromId: string, toId: string): DraftLoginRelationshipRow {
  return {
    id,
    fromId,
    toId,
    type: 'MemberOf',
    role: null,
    metadata: {},
    isBidirectional: false,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'Active',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
}

function login(): DraftLoginTagRow {
  return {
    id: 'tag-1',
    entityType: 'MdmEntity',
    entityId: PERSON,
    tag: 'Ada@Example.com',
    namespace: 'login',
    module: 'organization',
    createdBy: 'app',
    createdByType: 'system',
    createdAt: '2026-11-11T00:00:00.000Z',
  };
}

function loaded(): DraftLoginLoaded {
  return {
    email: EMAIL,
    login: login(),
    indexes: new Map([
      [PERSON, index(PERSON, 'Person', 'Original')],
      [PROD_COMPANY, index(PROD_COMPANY, 'Company', 'Prod Co')],
      [PARTNER, index(PARTNER, 'Company', 'Partner')],
      [PLACE, index(PLACE, 'Location', 'Place')],
    ]),
    documents: new Map([
      [PERSON, document(PERSON, 'Original')],
      [PROD_COMPANY, document(PROD_COMPANY, 'Prod Co')],
      [PARTNER, document(PARTNER, 'Partner')],
      [PLACE, document(PLACE, 'Place')],
    ]),
    relationships: [
      relationship('rel-co', PERSON, PROD_COMPANY),
      relationship('rel-partner', PERSON, PARTNER),
      relationship('rel-place', PARTNER, PLACE),
    ],
    sourceReservations: [{ organizationKey: 'org-1', companyMdmId: PROD_COMPANY }],
    draftReservations: [{ organizationKey: 'org-1', companyMdmId: BOOT_COMPANY }],
    draftIndexIds: new Set([BOOT_COMPANY]),
  };
}

const bomb: Sql = {
  async query() {
    throw new Error('sql should not run');
  },
};

test('plan copies the login, one hop, and reuses the boot company', () => {
  const plan = planDraftLoginCopy(loaded());
  assert.deepEqual(plan.tags.map((row) => row.tag), [EMAIL]);
  assert.deepEqual(plan.indexes.map((row) => row.mdmId), [PERSON, PARTNER]);
  assert.deepEqual(plan.documents.map((row) => row.mdmId), [PERSON, PARTNER]);
  assert.equal(plan.indexes.some((row) => row.mdmId === PROD_COMPANY || row.mdmId === PLACE || row.mdmId === BOOT_COMPANY), false);
  assert.deepEqual(plan.relationships.map((row) => [row.id, row.fromId, row.toId]), [
    ['rel-co', PERSON, BOOT_COMPANY],
    ['rel-partner', PERSON, PARTNER],
  ]);
});

test('plan refuses a missing login, a missing person, a missing other end, and a missing boot company', () => {
  const missing = loaded();
  missing.login = null;
  assert.throws(() => planDraftLoginCopy(missing), (err: unknown) => {
    assert.ok(err instanceof DraftLoginCopyError);
    assert.equal(err.message, draftLoginCopyText('missing', 'en'));
    assert.equal(err.message.includes(EMAIL), false);
    return true;
  });
  assert.throws(() => planDraftLoginCopy(missing, 'pt'), (err: unknown) => {
    assert.ok(err instanceof DraftLoginCopyError);
    assert.equal(err.message, draftLoginCopyText('missing', 'pt'));
    return true;
  });

  const noPerson = loaded();
  noPerson.indexes = new Map([...noPerson.indexes].filter(([id]) => id !== PERSON));
  assert.throws(() => planDraftLoginCopy(noPerson), /incomplete/);

  const noPartnerDoc = loaded();
  const documents = new Map(noPartnerDoc.documents);
  documents.delete(PARTNER);
  noPartnerDoc.documents = documents;
  assert.throws(() => planDraftLoginCopy(noPartnerDoc), (err: unknown) => {
    assert.ok(err instanceof DraftLoginCopyError);
    assert.match(err.message, /other end/);
    assert.match(err.message, /partner-1/);
    return true;
  });

  const noBoot = loaded();
  noBoot.draftIndexIds = new Set();
  assert.throws(() => planDraftLoginCopy(noBoot), /organization company is missing/);
});

test('readonly and same do not copy; a second entry does not copy again until the generation changes', async () => {
  const key = `draft-key-${Date.now()}-skip`;
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loaded();
  };
  await copyDraftLogin({ sourceName: 'readonly', email: EMAIL, draftKey: key, generation: 't', from: bomb, to: bomb, load });
  await copyDraftLogin({ sourceName: 'same', email: EMAIL, draftKey: key, generation: 't', from: bomb, to: bomb, load });
  assert.equal(loads, 0);

  const seedKey = `draft-key-${Date.now()}-seed`;
  const run = (generation: string) => copyDraftLogin({
    sourceName: 'seed',
    email: 'Ada@Example.com',
    draftKey: seedKey,
    generation,
    from: bomb,
    to: bomb,
    load,
    write: async () => {},
  });
  try {
    assert.deepEqual(await run('t1'), { copied: true });
    assert.deepEqual(await run('t1'), { copied: false });
    assert.equal(loads, 1);
    assert.deepEqual(await copyDraftLogin({
      sourceName: 'copy',
      email: EMAIL,
      draftKey: seedKey,
      generation: 't2',
      from: bomb,
      to: bomb,
      load,
      write: async () => {},
    }), { copied: true });
    assert.equal(loads, 2);
    forgetDraftLoginCopy(seedKey);
    assert.deepEqual(await run('t2'), { copied: true });
    assert.equal(loads, 3);
  } finally {
    forgetDraftLoginCopy(seedKey);
  }
});

test('a failed write is visible and the next entry tries again', async () => {
  const key = `draft-key-${Date.now()}-fail`;
  let loads = 0;
  let writes = 0;
  const run = (write: () => Promise<void>) => copyDraftLogin({
    sourceName: 'seed',
    email: EMAIL,
    draftKey: key,
    generation: 'g',
    from: bomb,
    to: bomb,
    load: async () => {
      loads += 1;
      return loaded();
    },
    write,
  });
  try {
    await assert.rejects(
      () => run(async () => {
        writes += 1;
        throw new Error('insert failed on mdm_tag');
      }),
      (err: unknown) => {
        assert.ok(err instanceof DraftLoginCopyError);
        assert.match(err.message, /Could not copy the login into the draft/);
        assert.match(err.message, /mdm_tag/);
        assert.equal(err.message.includes(EMAIL), false);
        return true;
      },
    );
    assert.deepEqual(await run(async () => {
      writes += 1;
    }), { copied: true });
    assert.equal(loads, 2);
    assert.equal(writes, 2);
  } finally {
    forgetDraftLoginCopy(key);
  }
});

test('a login missing at the origin opens without a failure and is read again only after draftEnter', async () => {
  const key = `draft-key-${Date.now()}-absent`;
  const base = mkdtempSync(join(tmpdir(), 'draft-login-absent-'));
  const slug = 'team-102047';
  const draftKey = draftDirOf(base, slug);
  let loads = 0;
  let present = false;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(' '));
  };
  const origBase = desenvIo.getProjectsBaseDir;
  const origProject = desenvIo.resolveClientProjectId;
  const origWorktree = desenvIo.ensureDraftWorktree;
  const origFastForward = desenvIo.fastForwardDraft;
  const origDev = desenvIo.ensureDevProcess;
  const origReady = desenvIo.waitForDevReady;
  desenvIo.getProjectsBaseDir = () => base;
  desenvIo.resolveClientProjectId = () => '102047';
  desenvIo.ensureDraftWorktree = async () => '/tmp/draft';
  desenvIo.fastForwardDraft = async () => ({ status: 'up_to_date' });
  desenvIo.ensureDevProcess = () => ({ port: 4100, pid: 1, startedAt: 0, lastRequestAt: 0 });
  desenvIo.waitForDevReady = async () => true;
  const load = async () => {
    loads += 1;
    const row = loaded();
    if (!present) row.login = null;
    return row;
  };
  const run = (generation: string) => copyDraftLogin({
    sourceName: 'seed',
    email: EMAIL,
    draftKey,
    generation,
    lang: 'en',
    from: bomb,
    to: bomb,
    load,
    write: async () => {
      if (!present) throw new Error('write should not run');
    },
  });
  try {
    assert.deepEqual(await run('g1'), { copied: false });
    assert.deepEqual(await run('g1'), { copied: false });
    assert.deepEqual(await run('g2'), { copied: false });
    assert.equal(loads, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not in the app database/);
    assert.equal(warnings[0].includes(EMAIL), false);
    forgetDraftLoginCopy(draftKey);
    assert.deepEqual(await run('g2'), { copied: false });
    assert.equal(loads, 1);

    present = true;
    const entered = await runDraftEnter({ allowed: true, draft: slug, project: 102047 });
    assert.equal(entered.status, 200);
    assert.deepEqual(await run('g1'), { copied: true });
    assert.equal(loads, 2);
    assert.equal(warnings.length, 1);

    let waited = 0;
    writeDraftData(draftKey, { source: 'seed', at: 'g1', by: EMAIL });
    const again = await ensureDraftLoginCopied({
      base,
      slug,
      projectId: 102047,
      email: EMAIL,
      lang: 'en',
      waitUntilReady: async () => {
        waited += 1;
        return false;
      },
    });
    assert.deepEqual(again, { ok: true, copied: false });
    assert.equal(waited, 0);
  } finally {
    console.warn = originalWarn;
    desenvIo.getProjectsBaseDir = origBase;
    desenvIo.resolveClientProjectId = origProject;
    desenvIo.ensureDraftWorktree = origWorktree;
    desenvIo.fastForwardDraft = origFastForward;
    desenvIo.ensureDevProcess = origDev;
    desenvIo.waitForDevReady = origReady;
    forgetDraftLoginCopy(draftKey);
    forgetDraftLoginAbsent(draftKey);
    rmSync(base, { recursive: true, force: true });
  }
});

test('an email the login refuses does not fail the copy and is not logged again', async () => {
  const key = `draft-key-${Date.now()}-bad-email`;
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(' '));
  };
  const run = () => copyDraftLogin({
    sourceName: 'seed',
    email: 'not-an-email',
    draftKey: key,
    generation: 'g',
    from: bomb,
    to: bomb,
    load: async () => {
      throw new Error('should not load');
    },
  });
  try {
    assert.deepEqual(await run(), { copied: false });
    assert.deepEqual(await run(), { copied: false });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /login e-mail is required/);
  } finally {
    console.error = originalError;
    forgetDraftLoginAbsent(key);
  }
});

test('writes insert missing rows only and roll back when one insert fails', async () => {
  const plan: DraftLoginPlan = {
    tags: [login()],
    indexes: [index(PERSON, 'Person', 'Original')],
    documents: [],
    relationships: [],
  };
  const calls: string[] = [];
  let inserts = 0;
  const sql: Sql = {
    async query(text) {
      const line = text.replace(/\s+/gu, ' ').trim();
      calls.push(line);
      if (line.startsWith('INSERT')) {
        inserts += 1;
        if (inserts === 2) throw new Error('column "nope" does not exist');
      }
      return { rows: [] };
    },
  };
  await assert.rejects(() => writeDraftLoginPlan(sql, plan), /column "nope"/);
  assert.equal(calls.filter((line) => line === 'COMMIT').length, 0);
  assert.equal(calls.includes('ROLLBACK'), true);
  const insertsSql = calls.filter((line) => line.startsWith('INSERT'));
  assert.equal(insertsSql.length, 2);
  assert.equal(insertsSql.every((line) => line.includes('ON CONFLICT DO NOTHING')), true);
  assert.equal(calls.some((line) => line.startsWith('UPDATE') || line.startsWith('DELETE')), false);
});

test('readonly does not wait; a child that is not ready does not open a database; a remembered login does not wait', async () => {
  const base = mkdtempSync(join(tmpdir(), 'draft-login-copy-'));
  const slug = 'team-102047';
  const dir = draftDirOf(base, slug);
  try {
    writeDraftData(dir, { source: 'readonly', at: '2026-11-11T00:00:00.000Z', by: EMAIL });
    let waited = 0;
    const skipped = await ensureDraftLoginCopied({
      base,
      slug,
      projectId: 102047,
      email: EMAIL,
      lang: 'en',
      waitUntilReady: async () => {
        waited += 1;
        return true;
      },
    });
    assert.deepEqual(skipped, { ok: true, copied: false });
    assert.equal(waited, 0);

    const fresh = mkdtempSync(join(tmpdir(), 'draft-login-copy-'));
    try {
      const notReady = await ensureDraftLoginCopied({
        base: fresh,
        slug,
        projectId: 102047,
        email: EMAIL,
        lang: 'pt',
        parentDatabaseUrl: '',
        waitUntilReady: async () => false,
      });
      assert.deepEqual(notReady, { ok: false, reason: 'not-ready' });
      await assert.rejects(
        () => ensureDraftLoginCopied({
          base: fresh,
          slug,
          projectId: 102047,
          email: EMAIL,
          lang: 'en',
          parentDatabaseUrl: '',
          waitUntilReady: async () => true,
        }),
        (err: unknown) => {
          assert.ok(err instanceof DraftLoginCopyError);
          assert.equal(err.message, draftLoginCopyText('notConfigured', 'en'));
          return true;
        },
      );
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }

    const rememberedKey = draftDirOf(base, slug);
    writeDraftData(rememberedKey, { source: 'seed', at: '2026-11-11T00:00:00.000Z', by: EMAIL });
    forgetDraftLoginCopy(rememberedKey);
    await copyDraftLogin({
      sourceName: 'seed',
      email: EMAIL,
      draftKey: rememberedKey,
      generation: '2026-11-11T00:00:00.000Z',
      from: bomb,
      to: bomb,
      load: async () => loaded(),
      write: async () => {},
    });
    waited = 0;
    const again = await ensureDraftLoginCopied({
      base,
      slug,
      projectId: 102047,
      email: 'Ada@Example.com',
      lang: 'en',
      waitUntilReady: async () => {
        waited += 1;
        return false;
      },
    });
    assert.deepEqual(again, { ok: true, copied: false });
    assert.equal(waited, 0);
  } finally {
    forgetDraftLoginCopy(draftDirOf(base, slug));
    rmSync(base, { recursive: true, force: true });
  }
});
