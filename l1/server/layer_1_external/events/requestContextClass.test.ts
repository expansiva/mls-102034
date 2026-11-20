/// <mls fileReference="_102034_/l1/server/layer_1_external/events/requestContextClass.test.ts" enhancement="_blank" />
/**
 * Class guard (rt275): a test of the new functions that takes a `RequestContext` must build it with `createRequestContext`.
 * A hand-made object with `project` at the top, or a cast to `RequestContext`, hid a defect the real context would show
 * (the project lives in `sessionContext.project`). Text search only; it lists the offending files.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDERS = [HERE, join(HERE, '..', 'connections', 'external'), join(HERE, '..', '..', '..', '..', 'testing', 'events')];
const SELF = 'requestContextClass.test.ts';
const HAND_MADE = [
  /^\s*project:\s*\{\s*projectId\b/mu,
  /\bas\s+(?:unknown\s+as\s+)?RequestContext\b/u,
];

function sourceFiles(folder: string): string[] {
  try {
    return readdirSync(folder).filter((name) => /\.test\.ts$|Fixtures?\.ts$/u.test(name) && name !== SELF).map((name) => join(folder, name));
  } catch {
    return [];
  }
}

describe('contexts in tests of events and external systems', () => {
  it('no file builds a context by hand', () => {
    const files = FOLDERS.flatMap(sourceFiles);
    assert.ok(files.length > 5, 'the search must see the test files');
    const offenders = files.filter((file) => HAND_MADE.some((pattern) => pattern.test(readFileSync(file, 'utf8'))));
    assert.deepEqual(offenders, []);
  });
});
