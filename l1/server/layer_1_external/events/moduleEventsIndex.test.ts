/// <mls fileReference="_102034_/l1/server/layer_1_external/events/moduleEventsIndex.test.ts" enhancement="_blank"/>
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { moduleEventsIndex } from '/_102034_/l1/server/layer_1_external/events/moduleEventsIndex.js';
import { moduleEventRefText } from '/_102034_/l1/server/layer_1_external/events/types.js';

const root = mkdtempSync(path.join(tmpdir(), 'module-events-'));
let previousCwd = '';

function distOf(projectId: string): string {
  return path.join(root, 'dist', 'local', `_${projectId}_`);
}

function writeJs(projectId: string, relative: string, body: unknown): void {
  const file = path.join(distOf(projectId), relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `export default ${JSON.stringify(body)};\n`);
}

function writeIntegration(
  projectId: string,
  moduleId: string,
  body: { inbound?: unknown[]; outbound?: unknown[] },
): void {
  writeJs(projectId, `l4/${moduleId}/integration.defs.js`, body);
}

function captureWarn(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return run().finally(() => {
    console.warn = warn;
  }).then(() => lines);
}

before(() => {
  writeFileSync(path.join(root, 'config.json'), JSON.stringify({
    defaultProjectId: '900271',
    projects: {
      '900271': { root: '.', type: 'client' },
      '900272': { root: '.', type: 'client' },
      '900273': { root: '.', type: 'client' },
      '900274': { root: '.', type: 'client' },
      '900275': { root: '.', type: 'client' },
      '102033': { root: '.', type: 'master frontend' },
      '102034': { root: '.', type: 'master backend' },
    },
  }));
  previousCwd = process.cwd();
  process.chdir(root);
});

after(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('moduleEventsIndex', () => {
  it('maps one publisher and two subscribers', async () => {
    const eventId = 'closed';
    writeIntegration('900271', 'publisherModule', {
      outbound: [{ id: eventId, kind: 'event', to: 'any', on: 'Record.create', description: '', entityRefs: [] }],
    });
    writeIntegration('900271', 'firstSubscriber', {
      inbound: [{ id: 'heard', kind: 'event', from: 'publisherModule', event: eventId, writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    writeIntegration('900271', 'secondSubscriber', {
      inbound: [{ id: 'heardToo', kind: 'event', from: 'publisherModule', event: eventId, writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    const ref = moduleEventRefText({ module: 'publisherModule', eventId });
    const lines = await captureWarn(async () => {
      const index = await moduleEventsIndex('900271');
      assert.deepEqual(index.publishes.get(ref), { to: 'any' });
      assert.deepEqual(index.consumers.get(ref), ['firstSubscriber', 'secondSubscriber']);
    });
    assert.equal(lines.length, 0);
  });

  it('logs a subscriber of an event nobody publishes', async () => {
    writeIntegration('900272', 'lonelyModule', {
      inbound: [{ id: 'heard', kind: 'event', from: 'missingModule', event: 'closed', writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    const lines = await captureWarn(async () => {
      const index = await moduleEventsIndex('900272');
      assert.equal(index.publishes.size, 0);
      assert.equal(index.consumers.size, 0);
    });
    assert.equal(lines.some((line) => line.includes('nobody publishes') && line.includes('missingModule.closed')), true);
  });

  it('to a sibling keeps only that subscriber; any keeps every declared subscriber', async () => {
    writeIntegration('900273', 'publisherModule', {
      outbound: [{ id: 'closed', kind: 'event', to: 'chosenModule', on: 'Record.create', description: '', entityRefs: [] }],
    });
    writeIntegration('900273', 'chosenModule', {
      inbound: [{ id: 'heard', kind: 'event', from: 'publisherModule', event: 'closed', writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    writeIntegration('900273', 'otherModule', {
      inbound: [{ id: 'heardToo', kind: 'event', from: 'publisherModule', event: 'closed', writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    const limited = moduleEventRefText({ module: 'publisherModule', eventId: 'closed' });
    const lines = await captureWarn(async () => {
      const index = await moduleEventsIndex('900273');
      assert.deepEqual(index.publishes.get(limited), { to: 'chosenModule' });
      assert.deepEqual(index.consumers.get(limited), ['chosenModule']);
    });
    assert.equal(lines.length, 0);

    writeIntegration('900274', 'publisherModule', {
      outbound: [{ id: 'closed', kind: 'event', to: 'any', on: 'Record.create', description: '', entityRefs: [] }],
    });
    writeIntegration('900274', 'chosenModule', {
      inbound: [{ id: 'heard', kind: 'event', from: 'publisherModule', event: 'closed', writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    writeIntegration('900274', 'otherModule', {
      inbound: [{ id: 'heardToo', kind: 'event', from: 'publisherModule', event: 'closed', writes: ['Record'], effect: 'create', description: '', entityRefs: [] }],
    });
    const open = moduleEventRefText({ module: 'publisherModule', eventId: 'closed' });
    const openLines = await captureWarn(async () => {
      const index = await moduleEventsIndex('900274');
      assert.deepEqual(index.publishes.get(open), { to: 'any' });
      assert.deepEqual(index.consumers.get(open), ['chosenModule', 'otherModule']);
    });
    assert.equal(openLines.length, 0);
  });

  it('two modules with the same event id stay distinct by identity', async () => {
    writeIntegration('900275', 'firstModule', {
      outbound: [{ id: 'closed', kind: 'event', to: 'any', on: 'Record.create', description: '', entityRefs: [] }],
    });
    writeIntegration('900275', 'secondModule', {
      outbound: [{ id: 'closed', kind: 'event', to: 'any', on: 'Record.create', description: '', entityRefs: [] }],
    });
    const first = moduleEventRefText({ module: 'firstModule', eventId: 'closed' });
    const second = moduleEventRefText({ module: 'secondModule', eventId: 'closed' });
    const lines = await captureWarn(async () => {
      const index = await moduleEventsIndex('900275');
      assert.equal(index.publishes.has(first), true);
      assert.equal(index.publishes.has(second), true);
      assert.equal(index.publishes.size, 2);
    });
    assert.equal(lines.length, 0);
  });
});
