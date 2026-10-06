/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidatePostgres.test.ts" enhancement="_blank" />
import assert from "node:assert/strict";
import test from "node:test";
import { commitAllowed, commitResultAllowed } from "/_102034_/l1/server/layer_1_external/candidate/candidatePostgres.js";
import type { CandidatePersistence } from "/_102034_/l1/server/layer_1_external/candidate/candidateStore.js";

type CommitInput = Parameters<CandidatePersistence["commit"]>[0];
type CommitResultInput = Parameters<CandidatePersistence["commitResult"]>[0];

const permit = {
    resultId: "result-1",
    resultHash: "b".repeat(64),
    inputRevisionId: "rev-1",
    inputSnapshotHash: "a".repeat(64),
    inputRevisionNumber: 1,
    outputSnapshotHash: "c".repeat(64),
};

const pointer = { changeId: "change-2", revisionId: "rev-2", snapshotHash: "d".repeat(64), revisionNumber: 2 };

function commitInput(patch: Partial<CommitInput> = {}): CommitInput {
    return {
        pointerKey: "candidate/102047/app",
        expectedRevisionId: "rev-1",
        permit,
        pointer,
        snapshot: {
            key: "snap-key", changeId: pointer.changeId, revisionId: pointer.revisionId,
            snapshotHash: pointer.snapshotHash, revisionNumber: 2, baseId: "base",
            requestRevision: 1, request: "{}", files: [],
        },
        request: { key: "req-key", owner: "alice@example.com", expectedRevisionId: "rev-1", pointer },
        ...patch,
    };
}

const matchingPointer = {
    key: "candidate/102047/app",
    revisionId: "rev-1",
    snapshotHash: permit.inputSnapshotHash,
    revisionNumber: 1,
    resultRevisionId: "rev-1",
    resultSnapshotHash: permit.inputSnapshotHash,
    resultRevisionNumber: 1,
    resultId: permit.resultId,
    resultHash: permit.resultHash,
};

test("commitAllowed accepts a first publish when the pointer is absent", () => {
    assert.equal(commitAllowed(undefined, commitInput({ expectedRevisionId: null, permit: null })), true);
});

test("commitAllowed refuses a first publish when the pointer already exists", () => {
    assert.equal(commitAllowed(matchingPointer, commitInput({ expectedRevisionId: null, permit: null })), false);
});

test("commitAllowed accepts an update when every pointer field matches the permit", () => {
    assert.equal(commitAllowed(matchingPointer, commitInput()), true);
});

test("commitAllowed refuses a different expected revision", () => {
    assert.equal(commitAllowed(matchingPointer, commitInput({ expectedRevisionId: "rev-other" })), false);
});

test("commitAllowed refuses a divergent permit", () => {
    assert.equal(commitAllowed(matchingPointer, commitInput({
        permit: { ...permit, resultHash: "e".repeat(64) },
    })), false);
});

function resultInput(patch: Partial<CommitResultInput> = {}): CommitResultInput {
    return {
        pointerKey: "candidate/102047/app",
        expectedRevisionId: "rev-2",
        expectedSnapshotHash: "d".repeat(64),
        expectedRevisionNumber: 2,
        result: {
            key: "result-key",
            owner: "alice@example.com",
            expectedRevisionId: "rev-2",
            expectedSnapshotHash: "d".repeat(64),
            expectedRevisionNumber: 2,
            resultId: "result-2",
            resultHash: "f".repeat(64),
            manifest: {
                runId: "run", taskId: "task", status: "completed",
                outputSnapshotHash: "c".repeat(64), artifacts: [], traceHash: "1".repeat(64),
            },
            outputSnapshot: {
                snapshotHash: "c".repeat(64), baseId: "base", requestRevision: 1, request: "{}", files: [],
            },
        },
        ...patch,
    };
}

const openPointer = {
    key: "candidate/102047/app",
    revisionId: "rev-2",
    snapshotHash: "d".repeat(64),
    revisionNumber: 2,
};

test("commitResultAllowed accepts a pointer with the expected revision, hash and number and no result", () => {
    assert.equal(commitResultAllowed(openPointer, resultInput()), true);
});

test("commitResultAllowed refuses a different revision", () => {
    assert.equal(commitResultAllowed(openPointer, resultInput({ expectedRevisionId: "rev-other" })), false);
});

test("commitResultAllowed refuses a different snapshot hash", () => {
    assert.equal(commitResultAllowed(openPointer, resultInput({ expectedSnapshotHash: "9".repeat(64) })), false);
});

test("commitResultAllowed refuses a different revision number", () => {
    assert.equal(commitResultAllowed(openPointer, resultInput({ expectedRevisionNumber: 3 })), false);
});

test("commitResultAllowed refuses a pointer that already has resultId", () => {
    assert.equal(commitResultAllowed({ ...openPointer, resultId: "result-1" }, resultInput()), false);
});
