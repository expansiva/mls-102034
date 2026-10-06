/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidateStore.test.ts" enhancement="_blank" />
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
