/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/draftAccess.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollabAuthClaims } from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { draftSlugForUser } from '/_102034_/l1/server/layer_1_external/cbe/cbeDraft.js';
import { canUseDraft } from '/_102034_/l1/server/layer_1_external/transport/http/draftAccess.js';
import { healthBody } from '/_102034_/l1/server/layer_1_external/transport/http/startServer.js';
import { applyDraftExecBff, planDraftExecBff } from '/_102034_/l1/server/layer_1_external/transport/http/draftProxy.js';

const claimsOf = (email: string, org?: string): CollabAuthClaims => ({ sub: `sub-${email}`, email, ...(org ? { active_org: { id: org } } : {}) });
const ORG = 'org-dona';
const deps = { projectOrgId: (_id: number): string | undefined => ORG };

test('user-…: só a pessoa dona do slug (o e-mail gera o slug); outra sessão, mesmo da mesma org, não', () => {
  const mine = draftSlugForUser('ana@example.test').slug;
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test', ORG), 102047, mine, deps), { allowed: true });
  assert.deepEqual(canUseDraft(claimsOf('ANA@example.test ', ORG), 102047, mine, deps), { allowed: true }, 'caixa e espaços não importam (mesmo código da pessoa)');
  assert.deepEqual(canUseDraft(claimsOf('beto@example.test', ORG), 102047, mine, deps), { allowed: false, reason: 'user-draft-not-yours' });
  assert.deepEqual(canUseDraft({ sub: 'x' } as CollabAuthClaims, 102047, mine, deps), { allowed: false, reason: 'user-draft-not-yours' }, 'sem e-mail não prova nada');
});

test('team-…: só a organização dona do projeto', () => {
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test', ORG), 102047, 'team-102047', deps), { allowed: true });
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test', 'outra-org'), 102047, 'team-102047', deps), { allowed: false, reason: 'team-draft-other-org' });
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test'), 102047, 'team-102047', deps), { allowed: false, reason: 'team-draft-no-org' });
  const conflicting = { ...claimsOf('ana@example.test', ORG), org_id: 'outra' } as CollabAuthClaims;
  assert.deepEqual(canUseDraft(conflicting, 102047, 'team-102047', deps), { allowed: false, reason: 'org-claims-conflict' });
});

test('sem arquivo do projeto (lima, dev) o dono é desconhecido: nada a comparar, passa; sem claims nada muda; slug ruim não passa', () => {
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test', 'qualquer'), 102047, 'team-102047', { projectOrgId: () => undefined }), { allowed: true });
  assert.deepEqual(canUseDraft(undefined, 102047, 'team-102047', deps), { allowed: true });
  assert.deepEqual(canUseDraft(claimsOf('ana@example.test', ORG), 102047, 'main', deps), { allowed: false, reason: 'bad-slug' });
});

test('planDraftExecBff: rascunho alheio vira forbidden 403 (nunca 401); o próprio e o sem-rascunho seguem como hoje', async () => {
  const mine = draftSlugForUser('ana@example.test').slug;
  const session = async () => ({ reject: false, claims: claimsOf('ana@example.test', ORG), reason: 'ok' as const });
  const forbidden = await planDraftExecBff({ 'x-collab-draft': draftSlugForUser('beto@example.test').slug }, session, 102047);
  assert.equal(forbidden.action, 'forbidden');
  assert.equal(forbidden.action === 'forbidden' && forbidden.statusCode, 403);
  assert.equal((await planDraftExecBff({ 'x-collab-draft': mine }, session, 102047)).action, 'proxy');
  assert.deepEqual(await planDraftExecBff({}, session, 102047), { action: 'local' });
  // a rejected session is still a 401 (login), decided before the owner is looked at
  const rejected = await planDraftExecBff({ 'x-collab-draft': mine }, async () => ({ reject: true, reason: 'invalid-token' as const }), 102047);
  assert.equal(rejected.action, 'unauthorized');
  // no project id: the call is not checked (callers that do not know it keep today's behavior)
  assert.equal((await planDraftExecBff({ 'x-collab-draft': draftSlugForUser('beto@example.test').slug }, session)).action, 'proxy');
});

test('applyDraftExecBff: rascunho alheio responde 403 DRAFT_FORBIDDEN, não chama o filho e não loga e-mail', async () => {
  const sent: Array<{ code?: number; body?: unknown }> = [];
  const reply = { code(code: number) { sent.push({ code }); return reply; }, send(body: unknown) { sent[sent.length - 1].body = body; return reply; }, header() { return reply; }, getHeader() { return undefined; } };
  const logs: string[] = [];
  const original = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => { logs.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };
  let ensured = 0;
  try {
    const result = await applyDraftExecBff({
      request: { headers: { 'x-collab-draft': draftSlugForUser('beto@example.test').slug }, body: { routine: 'm.r' } } as never,
      reply: reply as never,
      base: '/tmp/none',
      clientProjectId: '102047',
      resolveSession: async () => ({ reject: false, claims: claimsOf('ana@example.test', ORG), reason: 'ok' }),
      refreshedAuthCookie: () => '',
      ensureDevProcessImpl: () => { ensured += 1; throw new Error('não devia chamar'); },
    });
    assert.deepEqual(result, { handled: true });
  } finally {
    console.info = original;
    console.error = originalError;
  }
  assert.equal(ensured, 0);
  assert.equal(sent[0].code, 403);
  assert.deepEqual(sent[0].body, { ok: false, data: null, error: { code: 'DRAFT_FORBIDDEN', message: 'This draft is not yours to use.' } });
  const line = logs.join('\n');
  assert.match(line, /status=403 by=principal/u);
  assert.ok(!/ana@|beto@|example\.test/u.test(line), 'o log não traz e-mail');
});

test('healthBody: o filho do rascunho diz de quem é (ids, nada de pessoa); o principal segue com { ok: true }', () => {
  assert.deepEqual(healthBody({}), { ok: true });
  assert.deepEqual(healthBody({ COLLAB_DRAFT: 'team-102047', COLLAB_PROJECT_ID: '102047' }), { ok: true, projectId: 102047, slug: 'team-102047' });
  assert.deepEqual(healthBody({ COLLAB_DRAFT: 'team-102047', COLLAB_PROJECT_ID: 'abc' }), { ok: true });
  assert.deepEqual(healthBody({ COLLAB_PROJECT_ID: '102047' }), { ok: true });
});
