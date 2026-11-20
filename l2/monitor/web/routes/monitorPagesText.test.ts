/// <mls fileReference="_102034_/l2/monitor/web/routes/monitorPagesText.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  externalSystemsCatalog,
  externalSystemsErrorText,
  externalSystemsTextFor,
} from '/_102034_/l2/monitor/web/routes/externalSystemsText.js';
import {
  moduleEventsCatalog,
  moduleEventsErrorText,
  moduleEventsTextFor,
} from '/_102034_/l2/monitor/web/routes/moduleEventsText.js';

function sameKeys(catalog: Record<string, object>, name: string) {
  test(`${name}: pt tem as mesmas chaves de en`, () => {
    const en = Object.keys(catalog.en).sort();
    const pt = Object.keys(catalog.pt).sort();
    assert.deepEqual(pt, en);
    assert.ok(en.length > 0);
  });
}

sameKeys(externalSystemsCatalog(), 'externalSystems');
sameKeys(moduleEventsCatalog(), 'moduleEvents');

test('com a língua pt, o título é Sistemas externos e o botão é Atualizar', () => {
  const text = externalSystemsTextFor('pt');
  assert.equal(text.title, 'Sistemas externos');
  assert.equal(text.refresh, 'Atualizar');
  assert.equal(externalSystemsTextFor('pt-BR').title, 'Sistemas externos');
  assert.equal(moduleEventsTextFor('pt').refresh, 'Atualizar');
});

test('FORBIDDEN sai em pt pelo código, não pelo texto do servidor', () => {
  const text = externalSystemsTextFor('pt');
  const shown = externalSystemsErrorText('FORBIDDEN', text, text.loadFailed);
  assert.equal(shown, text.forbidden);
  assert.equal(shown.includes('App admin'), false);
  const events = moduleEventsTextFor('pt');
  assert.equal(moduleEventsErrorText('FORBIDDEN', events, events.loadFailed), events.forbidden);
  assert.equal(externalSystemsErrorText(undefined, text, text.loadFailed), text.loadFailed);
});

// O .less só entra na página por `loadStyle` (injetado depois do super() pelo processCSS); LitElement puro não tem esse método e o CSS some calado.
for (const page of ['externalSystems', 'moduleEvents']) {
  test(`${page}: a página que tem .less estende a classe com loadStyle e o cabeçalho deixa o processCSS injetar o .less`, () => {
    const source = readFileSync(new URL(`./${page}.ts`, import.meta.url), 'utf8');
    assert.match(source, /extends CollabLitElement\b/);
    // processCSS pula o arquivo cujo cabeçalho diz enhancement="_blank" (mls-ci/processCSS.js, addCssWithOutShadowRoot).
    assert.doesNotMatch(source.split('\n')[0], /enhancement="_blank"/);
  });
}
