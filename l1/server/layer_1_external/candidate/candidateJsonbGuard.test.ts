/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidateJsonbGuard.test.ts" enhancement="_blank" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "candidateStore.ts"), "utf8");

// s1 keeps JSON.stringify in manifestHash (canonical contract object), sameCanonical (sorted keys),
// prepareResult (the old :255 result hash, built field by field), and sameArtifactPaths (sorted
// string lists). Anything else must use sameCanonical or the canonical form.
const allowed = new Set(["manifestHash", "sameCanonical", "prepareResult", "sameArtifactPaths"]);

function functionNameAt(index: number): string | null {
    const head = source.slice(0, index);
    const matches = [...head.matchAll(/(?:export )?function ([A-Za-z0-9_]+)/g)];
    return matches.length === 0 ? null : matches[matches.length - 1][1];
}

void test("candidateStore JSON.stringify stays inside the canonical helpers", () => {
    const offenders: string[] = [];
    for (const match of source.matchAll(/JSON\.stringify\(/g)) {
        const name = functionNameAt(match.index ?? 0);
        if (!name || !allowed.has(name)) {
            const line = source.slice(0, match.index ?? 0).split("\n").length;
            offenders.push(`${name ?? "<top-level>"}:${line}`);
        }
    }
    assert.deepEqual(offenders, [], "use sameCanonical or the canonical form instead of JSON.stringify");
});
