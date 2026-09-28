/// <mls fileReference="_102034_/l1/scripts/mdmIdentityFixture.ts" enhancement="_blank" />
/**
 * MDM identity fixture: two distinct people, each bound to a login e-mail, and the proofs that the
 * binding — not the request body — decides what a session may read and transition.
 *
 * WHY A SCRIPT AND NOT A `.test.ts`: the suite (`run-tests 102034 l1`) runs on the memory runtime, and a
 * memory run proves nothing about a shared database. This runs in-process against whatever
 * `createDefaultRequestContext()` resolves — on a published app that is Postgres, and on a project in a
 * test mode (`development`/`presentation`) that is the TEST database. A `.test.ts` would drag the whole
 * suite towards a database it must not need.
 *
 * WHAT IS NOT EXERCISED HERE: the TRANSPORT. `startServer` is what stamps `verifiedEmail` /
 * `verifiedAuthorities` from a verified collab-auth token; calling `execBff` directly skips that step and
 * declares those fields itself. The proofs below are about what the RUNTIME does with a verified claim,
 * never about how a browser obtains one.
 */
import {
  createDefaultRequestContext,
  execBff,
} from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import type { RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { identityCacheKey } from '/_102034_/l1/server/layer_1_external/cache/identityCache.js';
import {
  MDM_LOGIN_ENTITY_TYPE,
  MDM_LOGIN_NAMESPACE,
} from '/_102034_/l1/mdm/layer_3_usecases/identityUsecases.js';
import { MDM_ORGANIZATION_MODULE_ID } from '/_102034_/l1/mdm/module.js';

/** RFC 2606 reserved TLD: an address here can never reach a real mailbox. */
export const FIXTURE_EMAIL_DOMAIN = 'rt32.fixture.invalid';
const FIXTURE_NAME_PREFIX = 'RT32 FIXTURE';
const MODULE_ID = 'agendaClinica';
const CONSULTA_REPOSITORY = 'consulta';

export interface FixturePerson {
  role: 'profissionalA' | 'profissionalB' | 'paciente';
  mdmId: string;
  name: string;
  /** '' for a person with no login row on purpose. */
  email: string;
  /** The collab-auth subject. Deliberately NOT the mdmId: they are different identities. */
  sub: string;
  authorities: readonly string[];
}

export interface FixtureConsulta {
  id: string;
  profissionalId: string;
  pacienteId: string;
  scheduledAt: string;
  status: string;
}

export interface IdentityFixture {
  runId: string;
  profissionalA: FixturePerson;
  profissionalB: FixturePerson;
  paciente: FixturePerson;
  /** An address that is NOT bound to any person — the "session without a binding" case. */
  unboundEmail: string;
  consultaA: FixtureConsulta;
  consultaB: FixtureConsulta;
}

export interface ProofOutcome {
  id: string;
  expectation: string;
  passed: boolean;
  detail: string;
}

/** Never print a whole id in the evidence. */
export function sanitize(value: string | undefined): string {
  if (!value) return '(empty)';
  return value.length <= 6 ? `…${value}` : `…${value.slice(-6)}`;
}

/** A fixture label keeps its role and drops the run id, so two actors never read as one. */
function sanitizeLabel(value: string): string {
  const parts = value.split('-');
  return parts.length > 1 ? `${parts.slice(0, -1).join('-')}-…` : sanitize(value);
}

function sanitizeEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return sanitizeLabel(email);
  return `${sanitizeLabel(email.slice(0, at))}@${email.slice(at + 1)}`;
}

interface CallInput {
  routine: string;
  params: Record<string, unknown>;
  verifiedEmail?: string;
  verifiedUserId?: string;
  verifiedAuthorities?: readonly string[];
  /** Body-declared identity, to prove it does not authenticate. */
  bodyActorId?: string;
}

interface CallOutcome {
  statusCode: number;
  ok: boolean;
  errorCode: string | null;
  data: unknown;
}

/**
 * One call on the same channel the monitor uses: `execBff` with a `source: 'http'` meta whose
 * `verified*` fields stand for what the transport WOULD have stamped from a verified token.
 */
async function call(ctx: RequestContext, input: CallInput): Promise<CallOutcome> {
  const result = await execBff({
    routine: input.routine,
    params: { ...input.params, ...(input.bodyActorId ? { actorId: input.bodyActorId } : {}) },
    meta: {
      source: 'http',
      ...(input.verifiedUserId ? { verifiedUserId: input.verifiedUserId } : {}),
      ...(input.verifiedEmail ? { verifiedEmail: input.verifiedEmail } : {}),
      ...(input.verifiedAuthorities?.length ? { verifiedAuthorities: [...input.verifiedAuthorities] } : {}),
      ...(input.bodyActorId ? { actorId: input.bodyActorId } : {}),
    },
  }, ctx);
  return {
    statusCode: result.statusCode,
    ok: result.response.ok === true,
    errorCode: result.response.error?.code ?? null,
    data: result.response.data,
  };
}

function rows(outcome: CallOutcome): Record<string, unknown>[] {
  return Array.isArray(outcome.data) ? outcome.data as Record<string, unknown>[] : [];
}

async function createPerson(
  ctx: RequestContext,
  role: FixturePerson['role'],
  runId: string,
  authorities: readonly string[],
  withLogin: boolean,
): Promise<FixturePerson> {
  const name = `${FIXTURE_NAME_PREFIX} ${role} ${runId}`;
  const created = await ctx.mdm.entity.create({
    details: { subtype: 'Person', name, status: 'Active' },
  });
  const email = withLogin ? `rt32-${role.toLowerCase()}-${runId}@${FIXTURE_EMAIL_DOMAIN}` : '';
  if (email) {
    // The API the task names. No second identity bridge is built here.
    await ctx.mdm.identity.setLogin(created.mdmId, email);
  }
  return {
    role,
    mdmId: created.mdmId,
    name,
    email,
    sub: `rt32-auth-sub-${role.toLowerCase()}-${runId}`,
    authorities,
  };
}

/** The reception session: an `organization` grant, so it may create appointments for any professional. */
function receptionCall(runId: string): Pick<CallInput, 'verifiedUserId' | 'verifiedAuthorities'> {
  return {
    verifiedUserId: `rt32-auth-sub-recepcao-${runId}`,
    verifiedAuthorities: [`${MODULE_ID}:recepcionista`],
  };
}

export async function setupIdentityFixture(ctx: RequestContext, runId: string): Promise<IdentityFixture> {
  const profissionalA = await createPerson(ctx, 'profissionalA', runId, [`${MODULE_ID}:profissional`], true);
  const profissionalB = await createPerson(ctx, 'profissionalB', runId, [`${MODULE_ID}:profissional`], true);
  const paciente = await createPerson(ctx, 'paciente', runId, [], false);

  const consultas: FixtureConsulta[] = [];
  for (const [index, owner] of [profissionalA, profissionalB].entries()) {
    const scheduledAt = `2099-01-0${index + 1}T09:00:00.000Z`;
    const created = await call(ctx, {
      routine: `${MODULE_ID}.consultas.cmdCreateConsulta`,
      params: {
        pacienteId: paciente.mdmId,
        profissionalId: owner.mdmId,
        scheduledAt,
        status: 'scheduled',
        details: { attendanceNote: '', telephoneConfirmation: { confirmedAt: '' } },
      },
      ...receptionCall(runId),
    });
    if (!created.ok) {
      throw new Error(`fixture setup failed for ${owner.role}: ${created.errorCode ?? created.statusCode}`);
    }
    const record = created.data as Record<string, unknown>;
    consultas.push({
      id: String(record.id),
      profissionalId: String(record.profissionalId),
      pacienteId: String(record.pacienteId),
      scheduledAt: String(record.scheduledAt),
      status: String(record.status),
    });
  }

  return {
    runId,
    profissionalA,
    profissionalB,
    paciente,
    unboundEmail: `rt32-sem-vinculo-${runId}@${FIXTURE_EMAIL_DOMAIN}`,
    consultaA: consultas[0]!,
    consultaB: consultas[1]!,
  };
}

/** Every field `qryListConsulta` demands — the generated validator requires all of them. */
function fullFilter(consulta: FixtureConsulta): Record<string, unknown> {
  return {
    id: consulta.id,
    pacienteId: consulta.pacienteId,
    profissionalId: consulta.profissionalId,
    scheduledAt: consulta.scheduledAt,
    status: consulta.status,
  };
}

export async function runIdentityProofs(
  ctx: RequestContext,
  fixture: IdentityFixture,
): Promise<ProofOutcome[]> {
  const out: ProofOutcome[] = [];
  const { profissionalA, profissionalB, consultaA } = fixture;

  // P1 — the owner reads the record that is his, and the identity that decides it came from the login row.
  const p1 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.qryListConsulta`,
    params: fullFilter(consultaA),
    verifiedUserId: profissionalA.sub,
    verifiedEmail: profissionalA.email,
    verifiedAuthorities: profissionalA.authorities,
  });
  out.push({
    id: 'P1',
    expectation: 'owner reads his own appointment',
    passed: p1.ok && rows(p1).some(row => row.id === consultaA.id),
    detail: `status=${p1.statusCode} rows=${rows(p1).length} error=${p1.errorCode ?? '-'}`,
  });

  // P2 — another professional, same authority, asking for the SAME record by id.
  const p2 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.qryListConsulta`,
    params: fullFilter(consultaA),
    verifiedUserId: profissionalB.sub,
    verifiedEmail: profissionalB.email,
    verifiedAuthorities: profissionalB.authorities,
  });
  out.push({
    id: 'P2',
    expectation: 'another actor does not read the appointment of the owner',
    passed: rows(p2).every(row => row.id !== consultaA.id),
    detail: `status=${p2.statusCode} rows=${rows(p2).length} error=${p2.errorCode ?? '-'}`,
  });

  // P3 — a verified e-mail with NO login row: there is no person, so there is no actorId.
  const p3 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.qryListConsulta`,
    params: fullFilter(consultaA),
    verifiedUserId: `rt32-auth-sub-sem-vinculo-${fixture.runId}`,
    verifiedEmail: fixture.unboundEmail,
    verifiedAuthorities: [`${MODULE_ID}:profissional`],
  });
  out.push({
    id: 'P3',
    expectation: 'a session with no MDM binding does not read the appointment of someone else',
    passed: rows(p3).every(row => row.id !== consultaA.id),
    detail: `status=${p3.statusCode} rows=${rows(p3).length} error=${p3.errorCode ?? '-'}`,
  });

  // P4 — the owner transitions his own record, and the state is persisted.
  const p4 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.cmdRegistrarAtendimento`,
    params: { id: consultaA.id, details: { attendanceNote: `rt32 ${fixture.runId}` } },
    verifiedUserId: profissionalA.sub,
    verifiedEmail: profissionalA.email,
    verifiedAuthorities: profissionalA.authorities,
  });
  const storedAfterP4 = await readConsultaRow(ctx, consultaA.id);
  out.push({
    id: 'P4',
    expectation: 'owner transitions his own appointment and the new state is persisted',
    passed: p4.ok && storedAfterP4?.status === 'attended',
    detail: `status=${p4.statusCode} error=${p4.errorCode ?? '-'} persisted=${String(storedAfterP4?.status)}`,
  });

  // P5 — the same transition, asked by the OTHER professional, on the record of the first one.
  // The verdict is about WHO refused: an authorization refusal (FORBIDDEN_ACTOR) or an absent record
  // (NOT_FOUND) is a scope working; any other refusal means the call reached the write path of a record
  // that is not the caller's and was stopped by something that is not the scope.
  const consultaB = fixture.consultaB;
  const p5 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.cmdRegistrarAtendimento`,
    params: { id: consultaB.id, details: { attendanceNote: `rt32 intruso ${fixture.runId}` } },
    verifiedUserId: profissionalA.sub,
    verifiedEmail: profissionalA.email,
    verifiedAuthorities: profissionalA.authorities,
  });
  const storedAfterP5 = await readConsultaRow(ctx, consultaB.id);
  const refusedByScope = !p5.ok && ['FORBIDDEN_ACTOR', 'NOT_FOUND'].includes(p5.errorCode ?? '');
  out.push({
    id: 'P5',
    expectation: 'another actor is refused BY SCOPE the transition of an appointment that is not his',
    passed: refusedByScope && storedAfterP5?.status === 'scheduled',
    detail: `status=${p5.statusCode} error=${p5.errorCode ?? '-'} refusedByScope=${refusedByScope}`
      + ` persisted=${String(storedAfterP5?.status)}`
      + ` ownerOfRecord=${sanitize(String(storedAfterP5?.profissionalId ?? ''))} caller=${sanitize(profissionalA.mdmId)}`,
  });

  // P6 — `sub`, `actorRef` and `mdmId` are three different identities, not one wearing three names.
  const distinct = new Set([profissionalA.sub, profissionalA.authorities[0] ?? '', profissionalA.mdmId]);
  out.push({
    id: 'P6',
    expectation: 'sub, actorRef/authority and mdmId are distinct identities',
    passed: distinct.size === 3,
    detail: `sub=${sanitizeLabel(profissionalA.sub)} authority=${profissionalA.authorities[0] ?? '-'}`
      + ` mdmId=${sanitize(profissionalA.mdmId)}`,
  });

  // P7 — an `actorId` declared by the caller does not authenticate: the body never decides identity.
  const p7 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.qryListConsulta`,
    params: fullFilter(consultaA),
    verifiedUserId: profissionalB.sub,
    verifiedEmail: profissionalB.email,
    verifiedAuthorities: profissionalB.authorities,
    bodyActorId: profissionalA.mdmId,
  });
  out.push({
    id: 'P7',
    expectation: 'actorId declared in the body does not grant the identity of the owner',
    passed: rows(p7).every(row => row.id !== consultaA.id),
    detail: `status=${p7.statusCode} rows=${rows(p7).length} error=${p7.errorCode ?? '-'}`,
  });

  // P8 — the write side of P3: a verified e-mail with NO login row asking to transition someone else's
  // record. Same reading of the verdict as P5: only FORBIDDEN_ACTOR/NOT_FOUND is the scope working.
  const p8 = await call(ctx, {
    routine: `${MODULE_ID}.agenda.cmdRegistrarAtendimento`,
    params: { id: consultaA.id, details: { attendanceNote: `rt32 sem vinculo ${fixture.runId}` } },
    verifiedUserId: `rt32-auth-sub-sem-vinculo-${fixture.runId}`,
    verifiedEmail: fixture.unboundEmail,
    verifiedAuthorities: [`${MODULE_ID}:profissional`],
  });
  const storedAfterP8 = await readConsultaRow(ctx, consultaA.id);
  const p8RefusedByScope = !p8.ok && ['FORBIDDEN_ACTOR', 'NOT_FOUND'].includes(p8.errorCode ?? '');
  out.push({
    id: 'P8',
    expectation: 'a session with no MDM binding is refused BY SCOPE the transition of a record of someone else',
    passed: p8RefusedByScope,
    detail: `status=${p8.statusCode} error=${p8.errorCode ?? '-'} refusedByScope=${p8RefusedByScope}`
      + ` persisted=${String(storedAfterP8?.status)}`,
  });

  return out;
}

export interface TransportProbe {
  url: string;
  statusCode: number;
  ok: boolean;
  errorCode: string | null;
  /** True when the e-mail the CLIENT put in the body bound the session to the fixture person. */
  bodyEmailCreatedBinding: boolean;
}

/**
 * THE ONLY LEG THAT IS NOT IN-PROCESS — and the only one that can answer it.
 *
 * `startServer` spreads `...request.meta` and overwrites the `verified*` fields only when it has verified
 * claims. With `BFF_JWT_ENABLED` off there are no claims, so whatever the body says about `verifiedEmail`
 * survives into `execBff`. Calling `execBff` directly can never show this: the call IS the body.
 * Measured, never repaired here.
 */
export async function probeTransport(
  url: string,
  fixture: IdentityFixture,
): Promise<TransportProbe> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      routine: `${MODULE_ID}.agenda.qryListConsulta`,
      params: fullFilter(fixture.consultaA),
      meta: {
        // Both fields are CLIENT-SUPPLIED here: no cookie, no token, no verified anything.
        verifiedEmail: fixture.profissionalA.email,
        verifiedAuthorities: [`${MODULE_ID}:profissional`],
      },
    }),
  });
  const body = await response.json() as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string } | null;
  };
  const found = Array.isArray(body.data)
    && (body.data as Record<string, unknown>[]).some(row => row.id === fixture.consultaA.id);
  return {
    url,
    statusCode: response.status,
    ok: body.ok === true,
    errorCode: body.error?.code ?? null,
    bodyEmailCreatedBinding: found,
  };
}

async function readConsultaRow(
  ctx: RequestContext,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = await ctx.data.moduleData.getTable<Record<string, unknown>>(CONSULTA_REPOSITORY);
  return table.findOne({ where: { id } });
}

export interface CleanupReport {
  consultasDeleted: number;
  personsDeleted: number;
  loginTagsDeleted: number;
  cacheKeysCleared: number;
  gaps: string[];
}

/**
 * Only the ids of THIS run, through the APIs that own them. Nothing broad: `collab_test` is shared and a
 * left-over row of mine breaks somebody else's fixture.
 */
export async function cleanupIdentityFixture(
  ctx: RequestContext,
  fixture: IdentityFixture,
): Promise<CleanupReport> {
  const report: CleanupReport = {
    consultasDeleted: 0,
    personsDeleted: 0,
    loginTagsDeleted: 0,
    cacheKeysCleared: 0,
    gaps: [],
  };

  const table = await ctx.data.moduleData.getTable<Record<string, unknown>>(CONSULTA_REPOSITORY);
  for (const consulta of [fixture.consultaA, fixture.consultaB]) {
    if (await table.findOne({ where: { id: consulta.id } })) {
      await table.delete({ where: { id: consulta.id } });
      report.consultasDeleted += 1;
    }
  }
  // The generated `ConsultaRepository` port has create/list/update/transition and no delete, so the row
  // is removed through the module data runtime it is stored by.
  report.gaps.push(
    'ConsultaRepository (102047 agendaClinica) declares no delete: the fixture row is removed through '
    + 'ctx.data.moduleData — owner: supervisor L1 / gerador de repositório.',
  );

  for (const person of [fixture.profissionalA, fixture.profissionalB, fixture.paciente]) {
    if (person.email) {
      // No `identity.unsetLogin` exists (MdmIdentity exposes findByLogin/setLogin/invite only), so the
      // login row is removed by the exact key tuple `setLogin` itself writes and deletes with.
      await ctx.data.mdmTag.delete({
        where: {
          entityType: MDM_LOGIN_ENTITY_TYPE,
          entityId: person.mdmId,
          tag: person.email,
          module: MDM_ORGANIZATION_MODULE_ID,
          namespace: MDM_LOGIN_NAMESPACE,
        },
      });
      report.loginTagsDeleted += 1;
      await ctx.cache.del(identityCacheKey(person.email));
      report.cacheKeysCleared += 1;
    }
    try {
      await ctx.mdm.entity.delete({ mdmId: person.mdmId, allowActiveRelationships: true });
      report.personsDeleted += 1;
    } catch (error) {
      report.gaps.push(
        `mdm.entity.delete failed for ${person.role} (${sanitize(person.mdmId)}): `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }
  await ctx.cache.del(identityCacheKey(fixture.unboundEmail));
  report.cacheKeysCleared += 1;

  report.gaps.push(
    'MdmIdentity has no unsetLogin/removeLogin usecase: undoing a setLogin has no supported API — '
    + 'owner: supervisor L1 (dono do identityUsecases).',
  );
  report.gaps.push(
    'mdm_audit_log and mdm_monitoring_write are append-only trails: they keep the rows of this run by '
    + 'design, and no cleanup is supposed to remove them.',
  );
  report.gaps.push(
    'mdm_outbox is the write-behind QUEUE, not a trail: its rows are meant to be drained by '
    + 'runWriteBehindWorker. Count it and check whether a worker runs on the host before calling the '
    + 'left-over rows harmless.',
  );
  return report;
}

export async function countLoginTags(ctx: RequestContext): Promise<number> {
  const found = await ctx.data.mdmTag.findMany({
    where: { entityType: MDM_LOGIN_ENTITY_TYPE, namespace: MDM_LOGIN_NAMESPACE },
  });
  return found.length;
}

function trail(fixture: IdentityFixture): string[] {
  const lines: string[] = [];
  for (const [person, consulta] of [
    [fixture.profissionalA, fixture.consultaA] as const,
    [fixture.profissionalB, fixture.consultaB] as const,
  ]) {
    lines.push(
      `session(verifiedEmail=${sanitizeEmail(person.email)}, sub=${sanitizeLabel(person.sub)})`
      + ` -> actorId=mdmId=${sanitize(person.mdmId)}`
      + ` -> authority=${person.authorities[0] ?? '-'}`
      + ` -> ${MODULE_ID}.agenda.* -> consulta=${sanitize(consulta.id)}`,
    );
  }
  return lines;
}

export async function main(): Promise<number> {
  const ctx = createDefaultRequestContext();
  const runId = ctx.idGenerator.newId().slice(-8);
  const before = await countLoginTags(ctx);
  console.info(`[rt32] login tags before: ${before}`);

  let fixture: IdentityFixture | null = null;
  let failures = 0;
  try {
    fixture = await setupIdentityFixture(ctx, runId);
    console.info(`[rt32] login tags after setup: ${await countLoginTags(ctx)}`);
    for (const line of trail(fixture)) console.info(`[rt32] trail ${line}`);
    for (const proof of await runIdentityProofs(ctx, fixture)) {
      if (!proof.passed) failures += 1;
      console.info(`[rt32] ${proof.id} ${proof.passed ? 'PASS' : 'FAIL'} — ${proof.expectation} | ${proof.detail}`);
    }
    const probeUrl = process.env.RT32_TRANSPORT_PROBE_URL;
    if (probeUrl) {
      const probe = await probeTransport(probeUrl, fixture);
      console.info(`[rt32] T1 transport probe (client-supplied verifiedEmail, no token):`
        + ` status=${probe.statusCode} ok=${probe.ok} error=${probe.errorCode ?? '-'}`
        + ` bodyEmailCreatedBinding=${probe.bodyEmailCreatedBinding}`);
    } else {
      console.info('[rt32] T1 transport probe NOT RUN (no RT32_TRANSPORT_PROBE_URL)');
    }
  } finally {
    if (fixture) {
      const report = await cleanupIdentityFixture(ctx, fixture);
      console.info(`[rt32] cleanup ${JSON.stringify({
        consultasDeleted: report.consultasDeleted,
        personsDeleted: report.personsDeleted,
        loginTagsDeleted: report.loginTagsDeleted,
        cacheKeysCleared: report.cacheKeysCleared,
      })}`);
      for (const gap of report.gaps) console.info(`[rt32] gap ${gap}`);
    }
    console.info(`[rt32] login tags after cleanup: ${await countLoginTags(ctx)}`);
  }
  return failures;
}

const isMainModule = process.argv[1]?.endsWith('/mdmIdentityFixture.js');

if (isMainModule) {
  main()
    .then((failures) => {
      console.info(failures === 0 ? '[rt32] all proofs passed' : `[rt32] ${failures} proof(s) did not match the expectation`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
