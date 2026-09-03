/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/gitHttp.test.ts" enhancement="_blank" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorOf, gitBackendEnv, parseGitPath, projectGitDir, splitCgiHeaders, tokenFromGitRequest,
} from '/_102034_/l1/server/layer_1_external/transport/http/gitHttp.js';

test('parseGitPath aceita os três endpoints smart, com e sem .git', () => {
  assert.deepEqual(parseGitPath('/git/mls-102043.git/info/refs?service=git-upload-pack'), {
    projectId: '102043', endpoint: 'info/refs', query: 'service=git-upload-pack',
  });
  assert.equal(parseGitPath('/git/mls-102043/git-receive-pack')?.endpoint, 'git-receive-pack');
  assert.equal(parseGitPath('/git/mls-102043.git/git-upload-pack')?.endpoint, 'git-upload-pack');
});

test('parseGitPath recusa o que não é endpoint smart, e recusa travessia de path', () => {
  // O protocolo dumb ficaria de fora da autenticação por objeto solto — não existe aqui.
  assert.equal(parseGitPath('/git/mls-102043.git/objects/info/packs'), null);
  assert.equal(parseGitPath('/git/mls-102043.git/HEAD'), null);
  // O id vira caminho de arquivo: qualquer coisa que não seja dígito não passa.
  assert.equal(parseGitPath('/git/mls-../../etc.git/info/refs'), null);
  assert.equal(parseGitPath('/git/mls-102043.git/../../info/refs'), null);
  assert.equal(parseGitPath('/execBff'), null);
  assert.equal(parseGitPath(undefined), null);
});

test('tokenFromGitRequest lê o token da SENHA do Basic (formato PAT), com o usuário ignorado', () => {
  const basic = `Basic ${Buffer.from('collab:tok-123').toString('base64')}`;
  assert.equal(tokenFromGitRequest({ authorization: basic }), 'tok-123');
  // Helper ao contrário: o token no usuário e a senha vazia.
  const inverted = `Basic ${Buffer.from('tok-456:').toString('base64')}`;
  assert.equal(tokenFromGitRequest({ authorization: inverted }), 'tok-456');
});

test('tokenFromGitRequest aceita Bearer e devolve vazio no resto', () => {
  assert.equal(tokenFromGitRequest({ authorization: 'Bearer tok-789' }), 'tok-789');
  assert.equal(tokenFromGitRequest({ authorization: 'Digest x' }), '');
  assert.equal(tokenFromGitRequest({}), '');
  assert.equal(tokenFromGitRequest(undefined), '');
  // Um cookie NÃO autentica esta porta: o git não tem cookie jar nosso, e aceitar cookie aqui
  // abriria a porta de escrita para qualquer aba logada (CSRF de push).
  assert.equal(tokenFromGitRequest({ cookie: 'cauth=tok-000' }), '');
});

test('splitCgiHeaders separa cabeçalhos do corpo e tira o Status da lista', () => {
  const parsed = splitCgiHeaders(Buffer.from(
    'Status: 403 Forbidden\r\nContent-Type: application/x-git-upload-pack-advertisement\r\n\r\n0000body',
  ));
  assert.equal(parsed?.status, 403);
  assert.equal(parsed?.headers['Content-Type'], 'application/x-git-upload-pack-advertisement');
  assert.equal(parsed?.headers.Status, undefined);
  assert.equal(parsed?.rest.toString(), '0000body');
});

test('splitCgiHeaders aceita LF puro, e devolve null enquanto a linha em branco não chegou', () => {
  const parsed = splitCgiHeaders(Buffer.from('Content-Type: text/plain\n\nok'));
  assert.equal(parsed?.status, 200);
  assert.equal(parsed?.rest.toString(), 'ok');
  assert.equal(splitCgiHeaders(Buffer.from('Content-Type: text/pl')), null);
});

test('gitBackendEnv aponta o PATH_INFO para o .git do projeto e habilita o push por env', () => {
  const env = gitBackendEnv({
    root: '/data/mls-base',
    projectId: '102043',
    target: { projectId: '102043', endpoint: 'git-receive-pack', query: '' },
    method: 'POST',
    email: 'wagner@collab.codes',
    remoteAddress: '10.0.0.1',
    contentType: 'application/x-git-receive-pack-request',
    contentEncoding: 'gzip',
  });
  assert.equal(env.GIT_PROJECT_ROOT, '/data/mls-base');
  assert.equal(env.PATH_INFO, '/mls-102043/.git/git-receive-pack');
  // Sem http.receivepack o http-backend recusa TODO push, e repos criados antes disto (gb14a)
  // não têm essa config — por isso vai por env, não por config do repositório.
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.receivepack');
  assert.equal(env.GIT_CONFIG_VALUE_0, 'true');
  // O http-backend deriva GIT_COMMITTER_* do REMOTE_USER: a atribuição é do git, não nossa.
  assert.equal(env.REMOTE_USER, 'wagner@collab.codes');
  assert.equal(env.COLLAB_PUSH_ACTOR_EMAIL, 'wagner@collab.codes');
  assert.equal(env.HTTP_CONTENT_ENCODING, 'gzip');
  // Sem content-length declarado, o http-backend lê stdin até o EOF — que é o caso do push chunked.
  assert.equal(env.CONTENT_LENGTH, undefined);
});

test('projectGitDir aponta o .git do repo de trabalho (updateInstead), não um bare', () => {
  assert.equal(projectGitDir('/data/mls-base', '102043'), '/data/mls-base/mls-102043/.git');
});

test('actorOf: pessoa é o e-mail; automação é service:<prefixo da chave> (gb53)', () => {
  assert.equal(actorOf({ email: 'wagner@collab.codes' }), 'wagner@collab.codes');
  // O token de serviço TEM e-mail (o git precisa de algo para estampar), mas é de uma máquina.
  // Registrar automação como pessoa numa auditoria seria pior que não auditar.
  assert.equal(
    actorOf({ service: true, key_prefix: 'cak_ab12cd34', email: 'service+cak_ab12cd34@service.collab.codes' }),
    'service:cak_ab12cd34',
  );
  assert.equal(actorOf({ service: true }), 'service:unknown');
  assert.equal(actorOf({}), '');
});
