import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

void test('organization selection and refresh use only issuer-verified tenant claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const issuer = 'https://fixture.invalid';
  const now = Math.floor(Date.now() / 1000);
  const sign = (sub: string, extra: Record<string, unknown>, expired = false) =>
    new SignJWT({ email: 'fixture@example.invalid', ...extra })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setIssuedAt(now - 3600)
      .setExpirationTime(expired ? now - 5 : now + 3600)
      .sign(privateKey);
  const initial = await sign('user', { orgs: [{ id: 'a', name: 'A' }] });
  const selected = await sign('user', { active_org: { id: 'a' } });
  const expired = await sign('user', { active_org: { id: 'a' } }, true);
  let responseToken = selected;
  let requestedOrg: unknown;
  const server = createServer(async (request, reply) => {
    if (request.url === '/.well-known/jwks.json') {
      reply.setHeader('content-type', 'application/json');
      reply.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requestedOrg = (JSON.parse(body) as { org_id?: unknown }).org_id;
    reply.setHeader('content-type', 'application/json');
    reply.end(JSON.stringify({ access_token: responseToken }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.COLLAB_AUTH_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.COLLAB_AUTH_JWKS_URL = `${process.env.COLLAB_AUTH_BASE_URL}/.well-known/jwks.json`;
    process.env.COLLAB_AUTH_ISSUER = issuer;
    const { resolveJwtSession, selectOrganization, verifyAccessToken } = await import('./cbeAuthJwt.js');
    const original = await verifyAccessToken(initial);

    assert.deepEqual(await resolveJwtSession(initial, 'refresh'), {});
    assert.equal(await selectOrganization(initial, original, 'a'), selected);
    assert.equal(requestedOrg, 'a');

    responseToken = await sign('other-user', { active_org: { id: 'a' } });
    assert.equal(await selectOrganization(initial, original, 'a'), null);
    responseToken = await sign('user', { active_org: { id: 'b' } });
    assert.equal(await selectOrganization(initial, original, 'a'), null);

    responseToken = selected;
    const refreshed = await resolveJwtSession(expired, 'refresh');
    assert.equal(requestedOrg, 'a');
    assert.equal(refreshed.newAccessToken, selected);
    responseToken = await sign('user', { orgs: [{ id: 'a', name: 'A' }] });
    assert.deepEqual(await resolveJwtSession(expired, 'refresh'), {});
  } finally {
    server.close();
  }
});
