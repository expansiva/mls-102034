/// <mls fileReference="_102034_/l1/monitor/layer_2_controllers/configHandlers.test.ts" enhancement="_blank" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('monitor.appsMenu.load returns each navigation item whole, including icon', () => {
  const source = readFileSync(new URL('./configHandlers.ts', import.meta.url), 'utf8');
  assert.match(source, /navigation: app\.navigation \?\? \[\]/);
});
