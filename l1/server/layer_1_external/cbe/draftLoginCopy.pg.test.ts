/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.pg.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import type { AppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { CacheRuntimeMemory } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';
import { draftDatabaseName, draftDatabaseUrl, draftDirOf } from '/_102034_/l1/server/layer_1_external/cbe/cbeDevProcess.js';
import {
  ensureDraftLoginCopied,
  forgetDraftLoginCopy,
} from '/_102034_/l1/server/layer_1_external/cbe/draftLoginCopy.js';
import { createPostgresDataRuntime } from '/_102034_/l1/mdm/layer_1_external/data/postgres/MdmDataRuntimePostgres.js';
import { organizationReservationKey } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { resolveSessionPerson } from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { tableDefinitions } from '/_102034_/l1/mdm/persistence.js';
import type { ResolvedTableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';
import { buildCreateIndexSql, buildCreateTableSql } from '/_102034_/l1/server/layer_1_external/persistence/schemaBootstrap.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const optedIn = process.env.RUN_INTEGRATION_TESTS === 'true';
const TABLES = ['mdmEntityIndex', 'mdmDocumentCache', 'mdmRelationship', 'mdmTag', 'mdmKv'] as const;
const EMAIL = 'ada@example.com';
const PERSON = 'person-1';
const PROD_COMPANY = 'prod-co';
const BOOT_COMPANY = 'boot-co';
const PARTNER = 'partner-1';
const PLACE = 'place-1';
const ORG = 'org-st70';

function tunnelUrl(): string {
  const raw = process.env.DRAFT_LOGIN_COPY_PG_URL ?? '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DRAFT_LOGIN_COPY_PG_URL must be a local tunnel URL');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  const hostOk = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (!hostOk || url.port !== '55432' || database !== 'collab_app_test') {
    throw new Error('DRAFT_LOGIN_COPY_PG_URL must be 127.0.0.1:55432/collab_app_test');
  }
  return raw;
}

function withDatabase(raw: string, name: string): string {
  const url = new URL(raw);
  url.pathname = `/${name}`;
  return url.toString();
}

function quoteDb(name: string): string {
  if (!/^collab_app_draft_[a-z0-9_]+$/u.test(name) || name === 'collab_app_test') {
    throw new Error('refusing database name');
  }
  return `"${name}"`;
}

function scrub(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres:\/\/\S+/giu, 'postgres://***').replace(/\s+/gu, ' ').slice(0, 180);
}

function definitions(): ResolvedTableDefinition[] {
  return tableDefinitions
    .filter((definition) => TABLES.includes(definition.repositoryName as typeof TABLES[number]))
    .map((definition) => ({
      ...definition,
      tableName: definition.tableName,
      projectId: 'draft-login-copy',
      repositoryName: definition.repositoryName ?? definition.tableName,
      logicalTableName: definition.tableName,
      dynamoResolvedTableName: null,
    }));
}

async function createSchema(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const definition of definitions()) {
      await client.query(buildCreateTableSql(definition));
      for (const sql of buildCreateIndexSql(definition)) await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function exec(connectionString: string, text: string, params: unknown[] = []): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(text, params);
  } finally {
    await client.end();
  }
}

async function rowsOf(connectionString: string, text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<Record<string, unknown>>(text, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

function indexSql(): string {
  return `INSERT INTO "mdm_documents_entities_index"
    ("mdmId", subtype, name, status, "docType", "docId", "countryCode", tags, "searchVector", "mergedInto", "dynamoPk", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, 'Active', NULL, NULL, 'BR', '{}', '', NULL, $1, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z')`;
}

async function seed(sourceUrl: string, draftUrl: string): Promise<void> {
  const at = '2026-11-11T00:00:00.000Z';
  const reservation = (companyMdmId: string) => JSON.stringify({
    schema: 1,
    kind: 'organization',
    organizationKey: ORG,
    companyMdmId,
  });
  await exec(sourceUrl, indexSql(), [PERSON, 'Person', 'Original']);
  await exec(sourceUrl, indexSql(), [PROD_COMPANY, 'Company', 'Prod Co']);
  await exec(sourceUrl, indexSql(), [PARTNER, 'Company', 'Partner']);
  await exec(sourceUrl, indexSql(), [PLACE, 'Location', 'Place']);
  await exec(
    sourceUrl,
    `INSERT INTO "mdm_documents" ("mdmId", version, details) VALUES ($1, 1, $2::jsonb), ($3, 1, $4::jsonb), ($5, 1, $6::jsonb), ($7, 1, $8::jsonb)`,
    [PERSON, JSON.stringify({ name: 'Original' }), PROD_COMPANY, JSON.stringify({ name: 'Prod Co' }), PARTNER, JSON.stringify({ name: 'Partner' }), PLACE, JSON.stringify({ name: 'Place' })],
  );
  await exec(
    sourceUrl,
    `INSERT INTO "mdm_tag" ("id", "entityType", "entityId", tag, namespace, module, "createdBy", "createdByType", "createdAt")
     VALUES ('tag-1', 'MdmEntity', $1, $2, 'login', 'organization', 'app', 'system', $3)`,
    [PERSON, EMAIL, at],
  );
  await exec(
    sourceUrl,
    `INSERT INTO "mdm_relationship"
      ("id", "fromId", "toId", type, role, metadata, "isBidirectional", "validFrom", "validTo", status, "createdAt", "updatedAt")
     VALUES
      ('rel-co', $1, $2, 'MemberOf', NULL, '{}'::jsonb, false, '2026-01-01', NULL, 'Active', $4, $4),
      ('rel-back', $2, $1, 'Employs', NULL, '{}'::jsonb, false, '2026-01-01', NULL, 'Active', $4, $4),
      ('rel-partner', $1, $3, 'PartnersWith', NULL, '{}'::jsonb, false, '2026-01-01', NULL, 'Active', $4, $4),
      ('rel-place', $3, 'place-1', 'LocatedAt', NULL, '{}'::jsonb, false, '2026-01-01', NULL, 'Active', $4, $4)`,
    [PERSON, PROD_COMPANY, PARTNER, at],
  );
  await exec(
    sourceUrl,
    `INSERT INTO "mdm_kv" (key, value) VALUES ($1, $2::jsonb)`,
    [organizationReservationKey(ORG), reservation(PROD_COMPANY)],
  );

  await exec(draftUrl, indexSql(), [PERSON, 'Person', 'Edited']);
  await exec(draftUrl, indexSql(), [BOOT_COMPANY, 'Company', 'Boot Co']);
  await exec(
    draftUrl,
    `INSERT INTO "mdm_documents" ("mdmId", version, details) VALUES ($1, 7, $2::jsonb), ($3, 1, $4::jsonb)`,
    [PERSON, JSON.stringify({ name: 'Edited' }), BOOT_COMPANY, JSON.stringify({ name: 'Boot Co' })],
  );
  await exec(
    draftUrl,
    `INSERT INTO "mdm_kv" (key, value) VALUES ($1, $2::jsonb)`,
    [organizationReservationKey(ORG), reservation(BOOT_COMPANY)],
  );
}

async function snapshot(connectionString: string): Promise<unknown> {
  const indexes = await rowsOf(
    connectionString,
    `SELECT "mdmId", subtype, name FROM "mdm_documents_entities_index" ORDER BY "mdmId"`,
  );
  const documents = await rowsOf(
    connectionString,
    `SELECT "mdmId", version, details::text AS details FROM "mdm_documents" ORDER BY "mdmId"`,
  );
  const tags = await rowsOf(
    connectionString,
    `SELECT id, "entityId", tag, "createdBy" FROM "mdm_tag" ORDER BY id`,
  );
  const relationships = await rowsOf(
    connectionString,
    `SELECT id, "fromId", "toId", type FROM "mdm_relationship" ORDER BY id`,
  );
  return { indexes, documents, tags, relationships };
}

test('opt-in without the lima tunnel URL fails', () => {
  if (!optedIn) return;
  tunnelUrl();
});

test('entry copies the login into a disposable draft database without a second company or a second write', { skip: !optedIn, timeout: 60_000 }, async () => {
  const adminUrl = tunnelUrl();
  const hex = randomBytes(4).toString('hex');
  const sourceName = `collab_app_draft_st70s2_${hex}`;
  const slug = `user-${randomBytes(8).toString('hex')}`;
  const projectId = 102047;
  const draftName = draftDatabaseName(slug, projectId);
  const sourceUrl = withDatabase(adminUrl, sourceName);
  const draftUrl = withDatabase(adminUrl, draftName);
  assert.equal(new URL(draftDatabaseUrl(sourceUrl, slug, projectId)).pathname, `/${draftName}`);
  const base = mkdtempSync(join(tmpdir(), 'draft-login-pg-'));
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteDb(sourceName)}`);
    await admin.query(`CREATE DATABASE ${quoteDb(draftName)}`);
    await createSchema(sourceUrl);
    await createSchema(draftUrl);
    await seed(sourceUrl, draftUrl);

    const entry = () => ensureDraftLoginCopied({
      base,
      slug,
      projectId,
      email: 'Ada@Example.com',
      lang: 'en',
      parentDatabaseUrl: sourceUrl,
      waitUntilReady: async () => true,
    });
    const first = await entry();
    assert.deepEqual(first, { ok: true, copied: true });

    const companies = await rowsOf(
      draftUrl,
      `SELECT "mdmId", name FROM "mdm_documents_entities_index" WHERE subtype = 'Company' ORDER BY "mdmId"`,
    );
    assert.deepEqual(companies, [
      { mdmId: BOOT_COMPANY, name: 'Boot Co' },
      { mdmId: PARTNER, name: 'Partner' },
    ]);
    const links = await rowsOf(
      draftUrl,
      `SELECT id, "fromId", "toId" FROM "mdm_relationship" ORDER BY id`,
    );
    assert.deepEqual(links, [
      { id: 'rel-back', fromId: BOOT_COMPANY, toId: PERSON },
      { id: 'rel-co', fromId: PERSON, toId: BOOT_COMPANY },
      { id: 'rel-partner', fromId: PERSON, toId: PARTNER },
    ]);
    const present = new Set(
      (await rowsOf(draftUrl, `SELECT "mdmId" FROM "mdm_documents_entities_index"`)).map((row) => row.mdmId),
    );
    for (const link of links) {
      assert.equal(present.has(link.fromId), true);
      assert.equal(present.has(link.toId), true);
    }
    const person = await rowsOf(draftUrl, `SELECT name FROM "mdm_documents_entities_index" WHERE "mdmId" = $1`, [PERSON]);
    assert.equal(person[0]?.name, 'Edited');
    const version = await rowsOf(draftUrl, `SELECT version FROM "mdm_documents" WHERE "mdmId" = $1`, [PERSON]);
    assert.equal(Number(version[0]?.version), 7);
    const place = await rowsOf(draftUrl, `SELECT "mdmId" FROM "mdm_documents_entities_index" WHERE "mdmId" = $1`, [PLACE]);
    assert.equal(place.length, 0);
    const prod = await rowsOf(draftUrl, `SELECT "mdmId" FROM "mdm_documents_entities_index" WHERE "mdmId" = $1`, [PROD_COMPANY]);
    assert.equal(prod.length, 0);

    const pool = new Pool({ connectionString: draftUrl, max: 1 });
    try {
      const runtime = createPostgresDataRuntime({ appEnv: 'development' } as AppEnv, pool);
      const found = await resolveSessionPerson({ data: runtime, cache: new CacheRuntimeMemory() } as unknown as RequestContext, EMAIL);
      assert.equal(found?.mdmId, PERSON);
      assert.equal(found?.email, EMAIL);
      assert.equal(found?.name, 'Edited');
    } finally {
      await pool.end();
    }

    const before = await snapshot(draftUrl);
    await exec(sourceUrl, `UPDATE "mdm_documents_entities_index" SET name = 'Changed' WHERE "mdmId" = $1`, [PARTNER]);
    const second = await entry();
    assert.deepEqual(second, { ok: true, copied: false });
    assert.deepEqual(await snapshot(draftUrl), before);
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    throw new Error(scrub(err));
  } finally {
    forgetDraftLoginCopy(draftDirOf(base, slug));
    rmSync(base, { recursive: true, force: true });
    for (const name of [sourceName, draftName]) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteDb(name)} WITH (FORCE)`);
      } catch (err) {
        console.error(`[cbe] draft login copy drop failed: ${scrub(err)}`);
      }
    }
    await admin.end();
  }
});
