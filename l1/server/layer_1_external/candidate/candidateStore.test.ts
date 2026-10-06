/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidateStore.test.ts" enhancement="_blank" />
// Legacy tests not ported — they were cadastro ACL, not this org check:
// candidateRevision.test.ts:232, :337, :356, and the changed-authorization part of :320.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
    candidateMarkResult, candidatePublish, candidateRead, handleCandidateRevision,
    type CandidateCaller, type CandidateMarkResultInput, type CandidatePersistence, type CandidatePublishInput,
} from "./candidateStore.js";

const hash = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const caller: CandidateCaller = { owner: "alice@example.com", orgId: "org-1" };
const hubOrgId = "org-1";
const acceptedExtraPaths = [
    "workspace-model.defs.ts", "journeys/checkIn2.defs.ts", "ontology/Patient2.defs.ts",
    "workspaces/mainDesk2.defs.ts",
] as const;
const rejectedExtraPaths = [
    "other/Patient.defs.ts", "journeys/CheckIn.defs.ts", "ontology/patient.defs.ts",
    "workspaces/MainDesk.defs.ts", "ontology/nested/Patient.defs.ts",
    "ontology/Patient-2.defs.ts", "journeys/check_in.defs.ts",
] as const;

class SharedTable implements CandidatePersistence {
    readonly records = new Map<string, { key: string; [field: string]: unknown }>();
    failStage = false;
    failAfterCommit = false;
    failRead = false;
    corruptStage = false;

    async get(key: string) {
        if (this.failRead) throw new Error("storage down");
        const row = this.records.get(key);
        return row && structuredClone(row);
    }

    async putFile(item: { key: string; contentBase64: string; sha256: string }) {
        if (this.failStage) throw new Error("connection lost after staging");
        if (this.records.has(item.key)) return false;
        this.records.set(item.key, structuredClone(this.corruptStage ? { ...item, contentBase64: "bad" } : item));
        return true;
    }

    async commit(input: Parameters<CandidatePersistence["commit"]>[0]) {
        const current = this.records.get(input.pointerKey);
        const prior = current?.revisionId ?? null;
        const revisionNumber = typeof current?.revisionNumber === "number" ? current.revisionNumber : 0;
        if (prior !== input.expectedRevisionId ||
            revisionNumber !== input.pointer.revisionNumber - 1 ||
            (input.expectedRevisionId !== null && (!input.permit ||
                current?.snapshotHash !== input.permit.inputSnapshotHash ||
                current?.resultRevisionId !== input.permit.inputRevisionId ||
                current?.resultSnapshotHash !== input.permit.inputSnapshotHash ||
                current?.resultRevisionNumber !== input.permit.inputRevisionNumber ||
                current?.resultId !== input.permit.resultId || current?.resultHash !== input.permit.resultHash)) ||
            this.records.has(input.snapshot.key) || this.records.has(input.request.key)) return false;
        this.records.set(input.pointerKey, { key: input.pointerKey, ...structuredClone(input.pointer) });
        this.records.set(input.snapshot.key, structuredClone(input.snapshot) as unknown as { key: string; [field: string]: unknown });
        this.records.set(input.request.key, structuredClone(input.request) as unknown as { key: string; [field: string]: unknown });
        if (this.failAfterCommit) return false;
        return true;
    }

    async commitResult(input: Parameters<CandidatePersistence["commitResult"]>[0]) {
        const current = this.records.get(input.pointerKey);
        if (current?.revisionId !== input.expectedRevisionId || current?.snapshotHash !== input.expectedSnapshotHash ||
            current?.revisionNumber !== input.expectedRevisionNumber || current?.resultId !== undefined ||
            this.records.has(input.result.key)) return false;
        this.records.set(input.result.key, structuredClone(input.result) as unknown as { key: string; [field: string]: unknown });
        this.records.set(input.pointerKey, {
            ...structuredClone(current), resultRevisionId: input.expectedRevisionId,
            resultSnapshotHash: input.expectedSnapshotHash, resultRevisionNumber: input.expectedRevisionNumber,
            resultId: input.result.resultId, resultHash: input.result.resultHash,
        });
        if (this.failAfterCommit) return false;
        return true;
    }
}

function proposal(content: string, requestId: string, expectedRevisionId: string | null = null): CandidatePublishInput {
    const paths = ["module.defs.ts", "journeys/index.defs.ts", "ontology/index.defs.ts",
        "rules.defs.ts", "workflows.defs.ts", "access.defs.ts", "integration.defs.ts", "ontology/Patient.defs.ts"];
    const files = paths.map((path) => {
        const bytes = Buffer.from(path === "ontology/Patient.defs.ts" ? content : `core:${path}`);
        return { path, sha256: hash(bytes), contentBase64: bytes.toString("base64"), bytes: bytes.length };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const metadata = files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
    const baseId = "base_one";
    const requestRevision = 1;
    const request = `Please change ${content}`;
    return {
        project: 102047, moduleName: "agendaClinica", expectedRevisionId, requestId,
        changeId: `change_${requestId}`, revisionId: `revision_${requestId}`,
        snapshot: {
            hash: hash(JSON.stringify({ baseId, requestRevision, request, files: metadata })),
            baseId, requestRevision, request,
            files: files.map(({ path, sha256, contentBase64 }) => ({ path, sha256, contentBase64 })),
        },
    };
}

function proposalWithExtraPath(path: string, requestId: string): CandidatePublishInput {
    const input = proposal(path, requestId);
    const extra = input.snapshot.files.find((file) => file.path === "ontology/Patient.defs.ts")!;
    extra.path = path;
    input.snapshot.files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const files = input.snapshot.files.map((file) => ({
        path: file.path, sha256: file.sha256, bytes: Buffer.from(file.contentBase64, "base64").length,
    }));
    input.snapshot.hash = hash(JSON.stringify({
        baseId: input.snapshot.baseId, requestRevision: input.snapshot.requestRevision,
        request: input.snapshot.request, files,
    }));
    return input;
}

function resultProposal(expected: { revisionId: string; snapshotHash: string; revisionNumber: number },
    output: CandidatePublishInput["snapshot"], resultId = "result_one",
    status: "completed" | "failed" | "disputed" = "completed"): CandidateMarkResultInput {
    const result = {
        runId: "run_one", taskId: "task_one", status,
        outputSnapshotHash: output.hash,
        artifacts: output.files.map(({ path, sha256 }) => ({ path, sha256 })),
        traceHash: "c".repeat(64),
    };
    return {
        project: 102047, moduleName: "agendaClinica", expectedRevisionId: expected.revisionId,
        expectedSnapshotHash: expected.snapshotHash, expectedRevisionNumber: expected.revisionNumber, resultId,
        resultHash: hash(JSON.stringify(result)), result, outputSnapshot: structuredClone(output),
    };
}

async function permitNext(table: SharedTable, current: { revisionId: string; snapshotHash: string; revisionNumber: number },
    next: CandidatePublishInput, resultId = `result_${next.requestId}`): Promise<CandidatePublishInput> {
    const mark = resultProposal(current, next.snapshot, resultId);
    const marked = await candidateMarkResult(caller, mark, hubOrgId, table);
    assert.equal(marked.status, "marked");
    next.permit = {
        resultId: mark.resultId, resultHash: mark.resultHash,
        inputRevisionId: mark.expectedRevisionId, inputSnapshotHash: mark.expectedSnapshotHash,
        inputRevisionNumber: mark.expectedRevisionNumber,
        outputSnapshotHash: mark.result.outputSnapshotHash,
    };
    return next;
}

void test("handles the /exec action with bidirectional access and an idempotent requestId", async () => {
    const table = new SharedTable();
    const args = { ...proposal("same", "routed"), action: "candidatePublish" as const };
    const first = await handleCandidateRevision(caller, args, hubOrgId, table);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(await handleCandidateRevision(caller, args, hubOrgId, table), first);
    const otherProject = await handleCandidateRevision(caller,
        { project: 123456, moduleName: "agendaClinica", action: "candidateRead" }, hubOrgId, table);
    assert.equal(otherProject.statusCode, 200);
    assert.equal(otherProject.status, "read");
    assert.equal(otherProject.pointer, null);
    assert.equal((await handleCandidateRevision({ owner: "", orgId: "org-1" }, args, hubOrgId, table)).statusCode, 401);
});

void test("lets exactly one creator win, preserves winner bytes, and keeps loser private", async () => {
    const table = new SharedTable();
    const client1 = candidatePublish(caller, proposal("winner", "one"), hubOrgId, table);
    const client2 = candidatePublish(caller, proposal("loser", "two"), hubOrgId, table);
    const results = await Promise.all([client1, client2]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["committed", "conflict"]);
    const winner = results.find((result) => result.status === "committed")!;
    const first = await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table);
    const second = await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table);
    assert.deepEqual(first, second);
    assert.deepEqual(first.pointer, winner.pointer);
    assert.equal(first.snapshot?.request, winner.pointer?.revisionId === "revision_one" ? "Please change winner" : "Please change loser");
    assert.equal(Buffer.from(first.snapshot!.files.find((file) => file.path === "ontology/Patient.defs.ts")!.contentBase64, "base64").toString(),
        winner.pointer?.revisionId === "revision_one" ? "winner" : "loser");
    assert.equal([...table.records.keys()].filter((key) => key.includes("/files/")).length, 16);
});

void test("retries the same request after a lost acknowledgement without incrementing twice", async () => {
    const table = new SharedTable();
    table.failAfterCommit = true;
    const input = proposal("first", "same");
    const first = await candidatePublish(caller, input, hubOrgId, table);
    assert.equal(first.status, "committed");
    assert.deepEqual(await candidatePublish(caller, input, hubOrgId, table), first);
    assert.equal(first.pointer?.revisionNumber, 1);
    assert.equal((await candidatePublish(caller, proposal("changed", "same"), hubOrgId, table)).msg, "candidate.request_reused");
    const otherRequest = proposal("first", "same");
    otherRequest.snapshot.request = "Another request";
    otherRequest.snapshot.hash = hash(JSON.stringify({ baseId: otherRequest.snapshot.baseId,
        requestRevision: otherRequest.snapshot.requestRevision, request: otherRequest.snapshot.request,
        files: otherRequest.snapshot.files.map((file) => ({
            path: file.path, sha256: file.sha256, bytes: Buffer.from(file.contentBase64, "base64").length,
        })) }));
    assert.equal((await candidatePublish(caller, otherRequest, hubOrgId, table)).msg, "candidate.request_reused");
});

void test("rejects a late finalize and preserves older idempotent results after a newer revision", async () => {
    const table = new SharedTable();
    const older = proposal("first", "first");
    const firstPublished = await candidatePublish(caller, older, hubOrgId, table);
    assert.equal(firstPublished.status, "committed");
    const newer = await permitNext(table, firstPublished.pointer!, proposal("second", "second", older.revisionId));
    assert.equal((await candidatePublish(caller, newer, hubOrgId, table)).pointer?.revisionNumber, 2);
    const late = proposal("late", "late", older.revisionId);
    late.permit = newer.permit;
    assert.equal((await candidatePublish(caller, late, hubOrgId, table)).status, "conflict");
    assert.equal((await candidatePublish(caller, older, hubOrgId, table)).pointer?.revisionId, older.revisionId);
    assert.equal((await candidateRead(caller, older, hubOrgId, table)).pointer?.revisionId, newer.revisionId);
});

void test("does not expose an active pointer on staging failure or corrupt staging", async () => {
    const table = new SharedTable();
    table.failStage = true;
    assert.equal((await candidatePublish(caller, proposal("first", "one"), hubOrgId, table)).status, "error");
    assert.equal((await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table)).pointer, null);
    table.failStage = false;
    table.corruptStage = true;
    assert.equal((await candidatePublish(caller, proposal("second", "two"), hubOrgId, table)).msg, "candidate.snapshot_unavailable");
    assert.equal((await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table)).pointer, null);
});

void test("rejects module/path traversal and bad hashes", async () => {
    const table = new SharedTable();
    assert.equal((await candidateRead(caller, { project: 102047, moduleName: "../other" }, hubOrgId, table)).statusCode, 400);
    const invalid = proposal("x", "one");
    invalid.snapshot.files[0].path = "../secret.defs.ts";
    assert.equal((await candidatePublish(caller, invalid, hubOrgId, table)).statusCode, 400);
    const incomplete = proposal("x", "one");
    incomplete.snapshot.files = incomplete.snapshot.files.filter((file) => file.path !== "rules.defs.ts");
    assert.equal((await candidatePublish(caller, incomplete, hubOrgId, table)).msg, "candidate.incomplete_snapshot");
    const badHash = proposal("x", "two");
    badHash.snapshot.files[0].sha256 = "0".repeat(64);
    assert.equal((await candidatePublish(caller, badHash, hubOrgId, table)).statusCode, 400);
    const tooLarge = proposal("x".repeat(250_001), "large");
    tooLarge.snapshot.request = "oversize source";
    assert.equal((await candidatePublish(caller, tooLarge, hubOrgId, table)).statusCode, 413);
});

void test("uses the canonical L4 snapshot path grammar shared with Studio and host", async () => {
    for (const [index, path] of acceptedExtraPaths.entries()) {
        const accepted = proposalWithExtraPath(path, `accepted_${index}`);
        const result = await candidatePublish(caller, accepted, hubOrgId, new SharedTable());
        assert.equal(result.status, "committed");
    }
    for (const [index, path] of rejectedExtraPaths.entries()) {
        const rejected = proposalWithExtraPath(path, `rejected_${index}`);
        const result = await candidatePublish(caller, rejected, hubOrgId, new SharedTable());
        assert.equal(result.statusCode, 400);
        assert.equal(result.msg, "candidate.invalid_file");
    }
});

void test("captures publish and mark-result inputs before their first await", async () => {
    const table = new SharedTable();
    const publishInput = proposal("immutable", "immutable");
    const publishExpected = structuredClone(publishInput);
    const publishing = candidatePublish(caller, publishInput, hubOrgId, table);
    publishInput.project = 999999;
    publishInput.moduleName = "otherModule";
    publishInput.changeId = "mutated_change";
    publishInput.revisionId = "mutated_revision";
    publishInput.requestId = "mutated_request";
    publishInput.snapshot.baseId = "mutated_base";
    publishInput.snapshot.files[0]!.path = "other/Illegal.defs.ts";
    const published = await publishing;
    assert.equal(published.status, "committed");
    assert.equal(published.pointer?.changeId, publishExpected.changeId);
    assert.equal(published.pointer?.revisionId, publishExpected.revisionId);
    assert.equal(published.pointer?.snapshotHash, publishExpected.snapshot.hash);

    const markInput = resultProposal(published.pointer!, publishExpected.snapshot, "immutable_result");
    const markExpected = structuredClone(markInput);
    const marking = candidateMarkResult(caller, markInput, hubOrgId, table);
    markInput.project = 999999;
    markInput.moduleName = "otherModule";
    markInput.expectedRevisionId = "mutated_revision";
    markInput.expectedSnapshotHash = "e".repeat(64);
    markInput.expectedRevisionNumber = 9;
    markInput.resultId = "mutated_result";
    markInput.resultHash = "f".repeat(64);
    markInput.result.taskId = "mutated_task";
    markInput.outputSnapshot.baseId = "mutated_base";
    markInput.outputSnapshot.files[0]!.path = "other/Illegal.defs.ts";
    const marked = await marking;
    assert.equal(marked.status, "marked");
    assert.equal(marked.pointer?.resultId, markExpected.resultId);
    assert.equal(marked.pointer?.resultHash, markExpected.resultHash);
});

void test("fails closed on storage outage", async () => {
    const table = new SharedTable();
    table.failRead = true;
    assert.equal((await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table)).statusCode, 503);
});

void test("marks a terminal result only on the current revision and retries lost acknowledgement idempotently", async () => {
    const table = new SharedTable();
    const revision = proposal("first", "one");
    const published = await candidatePublish(caller, revision, hubOrgId, table);
    assert.equal(published.status, "committed");
    table.failAfterCommit = true;
    const input = resultProposal(published.pointer!, revision.snapshot);
    const marked = await candidateMarkResult(caller, input, hubOrgId, table);
    assert.equal(marked.status, "marked");
    assert.equal(marked.pointer?.revisionId, revision.revisionId);
    assert.equal(marked.pointer?.resultRevisionId, revision.revisionId);
    assert.equal(marked.pointer?.resultSnapshotHash, revision.snapshot.hash);
    assert.equal(marked.pointer?.resultRevisionNumber, 1);
    assert.equal(marked.pointer?.resultId, input.resultId);
    assert.equal(marked.pointer?.resultHash, input.resultHash);
    assert.deepEqual(await candidateMarkResult(caller, input, hubOrgId, table), marked);
    const read = await candidateRead(caller, revision, hubOrgId, table);
    assert.deepEqual(read.pointer, marked.pointer);
    assert.deepEqual(read.result, {
        resultRevisionId: revision.revisionId, resultId: input.resultId,
        resultSnapshotHash: revision.snapshot.hash, resultRevisionNumber: 1,
        resultHash: input.resultHash, manifest: input.result,
    });
});

void test("invalidates the prior result atomically when a newer revision publishes", async () => {
    const table = new SharedTable();
    const first = proposal("first", "one");
    const firstPublished = await candidatePublish(caller, first, hubOrgId, table);
    table.failAfterCommit = false;
    const second = await permitNext(table, firstPublished.pointer!, proposal("second", "two", first.revisionId));
    const published = await candidatePublish(caller, second, hubOrgId, table);
    assert.equal(published.status, "committed");
    assert.equal(published.pointer?.revisionId, second.revisionId);
    assert.equal(published.pointer?.resultId, undefined);
    const read = await candidateRead(caller, second, hubOrgId, table);
    assert.equal(read.pointer?.resultId, undefined);
    const late = await candidateMarkResult(caller, resultProposal(firstPublished.pointer!, first.snapshot, "late_result"), hubOrgId, table);
    assert.equal(late.status, "conflict");
    assert.equal(late.pointer?.revisionId, second.revisionId);
    assert.equal(late.pointer?.resultId, undefined);
});

void test("retries a read when the active pointer changes while snapshot bytes are being verified", async () => {
    const table = new SharedTable();
    const first = await candidatePublish(caller, proposal("first", "one"), hubOrgId, table);
    const secondInput = await permitNext(table, first.pointer!, proposal("second", "two", first.pointer!.revisionId));
    const second = await candidatePublish(caller, secondInput, hubOrgId, table);
    const pointerKey = "candidate/102047/agendaClinica/active";
    table.records.set(pointerKey, { key: pointerKey, ...structuredClone(first.pointer!) });
    const originalGet = table.get.bind(table);
    let switched = false;
    table.get = async (key) => {
        const row = await originalGet(key);
        if (!switched && key.includes(`/changes/${first.pointer!.changeId}/revisions/${first.pointer!.revisionId}/snapshot`)) {
            switched = true;
            table.records.set(pointerKey, { key: pointerKey, ...structuredClone(second.pointer!) });
        }
        return row;
    };

    const read = await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table);
    assert.equal(read.status, "read");
    assert.deepEqual(read.pointer, second.pointer);
    assert.equal(read.snapshot?.request, "Please change second");
});

void test("rejects a late result when a revisionId is reused by a different snapshot", async () => {
    const table = new SharedTable();
    const firstInput = proposal("first-a", "one");
    firstInput.revisionId = "revision_reused";
    const first = await candidatePublish(caller, firstInput, hubOrgId, table);
    const late = resultProposal(first.pointer!, firstInput.snapshot, "late_first_a");

    const middleInput = await permitNext(table, first.pointer!, proposal("middle", "two", first.pointer!.revisionId));
    const middle = await candidatePublish(caller, middleInput, hubOrgId, table);
    const lastInput = await permitNext(table, middle.pointer!, proposal("last-a", "three", middle.pointer!.revisionId));
    lastInput.revisionId = "revision_reused";
    const last = await candidatePublish(caller, lastInput, hubOrgId, table);
    assert.equal(last.pointer?.revisionId, first.pointer?.revisionId);
    assert.notEqual(last.pointer?.snapshotHash, first.pointer?.snapshotHash);

    const marked = await candidateMarkResult(caller, late, hubOrgId, table);
    assert.equal(marked.status, "conflict");
    assert.deepEqual(marked.pointer, last.pointer);
    assert.equal(marked.pointer?.resultId, undefined);
});

void test("allows exactly one distinct result for a revision", async () => {
    const table = new SharedTable();
    const revision = proposal("first", "one");
    const published = await candidatePublish(caller, revision, hubOrgId, table);
    const [one, two] = await Promise.all([
        candidateMarkResult(caller, resultProposal(published.pointer!, revision.snapshot, "result_one"), hubOrgId, table),
        candidateMarkResult(caller, resultProposal(published.pointer!, revision.snapshot, "result_two"), hubOrgId, table),
    ]);
    assert.deepEqual([one.status, two.status].sort(), ["conflict", "marked"]);
});

void test("rejects a loose result hash, traversal and completed result without artifacts", async () => {
    const table = new SharedTable();
    const revision = proposal("first", "one");
    const published = await candidatePublish(caller, revision, hubOrgId, table);
    const loose = resultProposal(published.pointer!, revision.snapshot);
    loose.resultHash = "f".repeat(64);
    assert.equal((await candidateMarkResult(caller, loose, hubOrgId, table)).msg, "candidate.invalid_result_hash");
    const traversal = resultProposal(published.pointer!, revision.snapshot);
    traversal.result.artifacts[0].path = "../secret.json";
    assert.equal((await candidateMarkResult(caller, traversal, hubOrgId, table)).msg, "candidate.invalid_result_artifact");
    const empty = resultProposal(published.pointer!, revision.snapshot);
    empty.result.artifacts = [];
    empty.resultHash = hash(JSON.stringify(empty.result));
    assert.equal((await candidateMarkResult(caller, empty, hubOrgId, table)).msg, "candidate.invalid_result");
});

void test("requires a consumed authoritative result permit for every non-initial publication", async () => {
    const table = new SharedTable();
    const initial = proposal("initial", "initial");
    const first = await candidatePublish(caller, initial, hubOrgId, table);
    const direct = proposal("direct", "direct", first.pointer!.revisionId);
    assert.equal((await candidatePublish(caller, direct, hubOrgId, table)).msg, "candidate.result_permit_required");
    assert.deepEqual((await candidateRead(caller, initial, hubOrgId, table)).pointer, first.pointer);
});

void test("rejects partial, extra and duplicate output artifact manifests", async () => {
    const partialTable = new SharedTable();
    const initial = proposal("initial", "initial");
    const first = await candidatePublish(caller, initial, hubOrgId, partialTable);
    const output = proposal("output", "output", first.pointer!.revisionId);
    const partialMark = resultProposal(first.pointer!, output.snapshot, "partial");
    partialMark.result.artifacts = partialMark.result.artifacts.filter((artifact) => artifact.path !== "ontology/Patient.defs.ts");
    partialMark.resultHash = hash(JSON.stringify(partialMark.result));
    assert.equal((await candidateMarkResult(caller, partialMark, hubOrgId, partialTable)).msg, "candidate.result_artifact_paths_mismatch");
    assert.equal((await candidateRead(caller, initial, hubOrgId, partialTable)).pointer?.resultId, undefined);

    const extraTable = new SharedTable();
    const extraFirst = await candidatePublish(caller, initial, hubOrgId, extraTable);
    const extraOutput = proposal("output", "extra", extraFirst.pointer!.revisionId);
    const extraMark = resultProposal(extraFirst.pointer!, extraOutput.snapshot, "extra");
    extraMark.result.artifacts.push({ path: "ontology/Extra.defs.ts", sha256: "d".repeat(64) });
    extraMark.result.artifacts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    extraMark.resultHash = hash(JSON.stringify(extraMark.result));
    assert.equal((await candidateMarkResult(caller, extraMark, hubOrgId, extraTable)).msg, "candidate.result_artifact_paths_mismatch");
    assert.equal((await candidateRead(caller, initial, hubOrgId, extraTable)).pointer?.resultId, undefined);

    const duplicateTable = new SharedTable();
    const duplicateFirst = await candidatePublish(caller, initial, hubOrgId, duplicateTable);
    const duplicate = resultProposal(duplicateFirst.pointer!, initial.snapshot, "duplicate");
    duplicate.result.artifacts.push({ ...duplicate.result.artifacts[0] });
    duplicate.resultHash = hash(JSON.stringify(duplicate.result));
    assert.equal((await candidateMarkResult(caller, duplicate, hubOrgId, duplicateTable)).msg, "candidate.invalid_result_artifact");
});

void test("rejects arbitrary output hashes and divergent bytes before occupying the result mark", async () => {
    const table = new SharedTable();
    const initial = proposal("initial", "initial");
    const first = await candidatePublish(caller, initial, hubOrgId, table);
    const output = proposal("output", "output", first.pointer!.revisionId);

    const artifactHash = resultProposal(first.pointer!, output.snapshot, "bad_artifact_hash");
    artifactHash.result.artifacts[0].sha256 = "f".repeat(64);
    artifactHash.resultHash = hash(JSON.stringify(artifactHash.result));
    assert.equal((await candidateMarkResult(caller, artifactHash, hubOrgId, table)).msg, "candidate.result_output_mismatch");

    const outputHash = resultProposal(first.pointer!, output.snapshot, "bad_output_hash");
    outputHash.result.outputSnapshotHash = "e".repeat(64);
    outputHash.resultHash = hash(JSON.stringify(outputHash.result));
    assert.equal((await candidateMarkResult(caller, outputHash, hubOrgId, table)).msg, "candidate.result_output_mismatch");

    const bytes = resultProposal(first.pointer!, output.snapshot, "bad_output_bytes");
    bytes.outputSnapshot.files[0].contentBase64 = Buffer.from("different bytes").toString("base64");
    assert.equal((await candidateMarkResult(caller, bytes, hubOrgId, table)).msg, "candidate.invalid_file_hash");
    assert.equal((await candidateRead(caller, initial, hubOrgId, table)).pointer?.resultId, undefined);
});

void test("keeps partial output staging orphaned, rejects overwrite and retries the exact snapshot", async () => {
    const table = new SharedTable();
    const initial = proposal("initial", "initial");
    const first = await candidatePublish(caller, initial, hubOrgId, table);
    const output = proposal("output", "output", first.pointer!.revisionId);
    const mark = resultProposal(first.pointer!, output.snapshot, "result_staged_retry");
    const put = table.putFile.bind(table);
    let outputPuts = 0;
    table.putFile = async item => {
        if (item.key.includes("/results/result_staged_retry/output/files/") && ++outputPuts === 6) {
            throw new Error("staging interrupted");
        }
        return put(item);
    };
    assert.equal((await candidateMarkResult(caller, mark, hubOrgId, table)).msg, "candidate.storage_unavailable");
    assert.equal((await candidateRead(caller, initial, hubOrgId, table)).pointer?.resultId, undefined);
    assert.equal([...table.records.keys()].filter(key => key.includes("/results/result_staged_retry/output/files/")).length, 5);

    table.putFile = put;
    const divergent = proposal("divergent", "divergent", first.pointer!.revisionId);
    const divergentMark = resultProposal(first.pointer!, divergent.snapshot, "result_staged_retry");
    assert.equal((await candidateMarkResult(caller, divergentMark, hubOrgId, table)).msg, "candidate.immutable_file_conflict");
    assert.equal((await candidateRead(caller, initial, hubOrgId, table)).pointer?.resultId, undefined);

    assert.equal((await candidateMarkResult(caller, mark, hubOrgId, table)).status, "marked");
    output.permit = {
        resultId: mark.resultId, resultHash: mark.resultHash,
        inputRevisionId: mark.expectedRevisionId, inputSnapshotHash: mark.expectedSnapshotHash,
        inputRevisionNumber: mark.expectedRevisionNumber, outputSnapshotHash: mark.outputSnapshot.hash,
    };
    assert.equal((await candidatePublish(caller, output, hubOrgId, table)).status, "committed");
    assert.deepEqual((await candidateRead(caller, output, hubOrgId, table)).snapshot, output.snapshot);
});

void test("rejects permits for another result, revision, snapshot hash or non-completed result", async () => {
    const variants: Array<"result" | "revision" | "hash" | "failed" | "disputed"> =
        ["result", "revision", "hash", "failed", "disputed"];
    for (const variant of variants) {
        const table = new SharedTable();
        const initial = proposal(`initial-${variant}`, `initial_${variant}`);
        const first = await candidatePublish(caller, initial, hubOrgId, table);
        const output = proposal(`output-${variant}`, `output_${variant}`, first.pointer!.revisionId);
        const status = variant === "failed" || variant === "disputed" ? variant : "completed";
        const mark = resultProposal(first.pointer!, output.snapshot, `result_${variant}`, status);
        assert.equal((await candidateMarkResult(caller, mark, hubOrgId, table)).status, "marked");
        output.permit = {
            resultId: mark.resultId, resultHash: mark.resultHash,
            inputRevisionId: mark.expectedRevisionId, inputSnapshotHash: mark.expectedSnapshotHash,
            inputRevisionNumber: mark.expectedRevisionNumber, outputSnapshotHash: mark.result.outputSnapshotHash,
        };
        if (variant === "result") output.permit.resultId = "another_result";
        if (variant === "revision") output.permit.inputRevisionId = "another_revision";
        if (variant === "hash") output.permit.inputSnapshotHash = "f".repeat(64);
        assert.equal((await candidatePublish(caller, output, hubOrgId, table)).status, "error");
    }
});

void test("lets only one publication consume a result mark and keeps timeout retry idempotent", async () => {
    const raceTable = new SharedTable();
    const initial = proposal("initial", "initial");
    const first = await candidatePublish(caller, initial, hubOrgId, raceTable);
    const one = proposal("same-output", "one", first.pointer!.revisionId);
    const two = proposal("same-output", "two", first.pointer!.revisionId);
    two.snapshot = structuredClone(one.snapshot);
    await permitNext(raceTable, first.pointer!, one, "race_result");
    two.permit = structuredClone(one.permit);
    const raced = await Promise.all([
        candidatePublish(caller, one, hubOrgId, raceTable), candidatePublish(caller, two, hubOrgId, raceTable),
    ]);
    assert.deepEqual(raced.map((value) => value.status).sort(), ["committed", "conflict"]);

    const retryTable = new SharedTable();
    const retryFirst = await candidatePublish(caller, initial, hubOrgId, retryTable);
    const next = await permitNext(retryTable, retryFirst.pointer!, proposal("next", "next", retryFirst.pointer!.revisionId));
    retryTable.failAfterCommit = true;
    const committed = await candidatePublish(caller, next, hubOrgId, retryTable);
    assert.equal(committed.status, "committed");
    assert.deepEqual(await candidatePublish(caller, next, hubOrgId, retryTable), committed);
    const changedPermit = structuredClone(next);
    changedPermit.permit!.resultHash = "e".repeat(64);
    assert.equal((await candidatePublish(caller, changedPermit, hubOrgId, retryTable)).msg, "candidate.request_reused");
});

void test("rejects an empty owner on read and publish", async () => {
    const table = new SharedTable();
    const empty: CandidateCaller = { owner: "", orgId: "org-1" };
    const read = await candidateRead(empty, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table);
    assert.equal(read.statusCode, 401);
    assert.equal(read.msg, "candidate.unauthorized");
    const published = await candidatePublish(empty, proposal("x", "one"), hubOrgId, table);
    assert.equal(published.statusCode, 401);
    assert.equal(published.msg, "candidate.unauthorized");
});

void test("rejects an org that is not the hub org on read and publish", async () => {
    const table = new SharedTable();
    const other: CandidateCaller = { owner: "alice@example.com", orgId: "org-2" };
    const read = await candidateRead(other, { project: 102047, moduleName: "agendaClinica" }, hubOrgId, table);
    assert.equal(read.statusCode, 403);
    assert.equal(read.msg, "candidate.forbidden");
    const published = await candidatePublish(other, proposal("x", "one"), hubOrgId, table);
    assert.equal(published.statusCode, 403);
    assert.equal(published.msg, "candidate.forbidden");
});

void test("rejects a missing hub org on read and publish", async () => {
    const table = new SharedTable();
    const read = await candidateRead(caller, { project: 102047, moduleName: "agendaClinica" }, null, table);
    assert.equal(read.statusCode, 503);
    assert.equal(read.msg, "candidate.hub_org_unavailable");
    const published = await candidatePublish(caller, proposal("x", "one"), null, table);
    assert.equal(published.statusCode, 503);
    assert.equal(published.msg, "candidate.hub_org_unavailable");
});
