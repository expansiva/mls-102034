/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidateStore.ts" enhancement="_blank" />
import { createHash } from "node:crypto";

const TABLE = "cadastro";
const MAX_FILES = 80;
const MAX_FILE_BYTES = 250_000;
const MAX_SNAPSHOT_BYTES = 700_000;
const MAX_REQUEST_BYTES = 64_000;
const TOKEN = /^[A-Za-z0-9_-]{1,100}$/;
const MODULE = /^[a-z][A-Za-z0-9]{0,59}$/;
const RESULT_PATH = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const CORE_PATHS = [
    "module.defs.ts", "journeys/index.defs.ts", "ontology/index.defs.ts",
    "rules.defs.ts", "workflows.defs.ts", "access.defs.ts", "integration.defs.ts",
] as const;
const DYNAMIC_L4_PATH = /^(?:journeys\/[a-z][A-Za-z0-9]*|ontology\/[A-Z][A-Za-z0-9]*|workspaces\/[a-z][A-Za-z0-9]*)\.defs\.ts$/;

/** Canonical L4 snapshot grammar, intentionally duplicated at the Studio and CLI trust boundaries. */
function isCandidateSnapshotPath(path: string): boolean {
    return CORE_PATHS.some((core) => core === path) || path === "workspace-model.defs.ts" ||
        DYNAMIC_L4_PATH.test(path);
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    return value;
}

function frozenClone<T>(value: T): T {
    return deepFreeze(structuredClone(value));
}

interface FileInput { path: string; sha256: string; contentBase64: string }
interface FileMeta { path: string; sha256: string; bytes: number }
interface CandidatePointer {
    changeId: string;
    revisionId: string;
    snapshotHash: string;
    revisionNumber: number;
    resultRevisionId?: string;
    resultSnapshotHash?: string;
    resultRevisionNumber?: number;
    resultId?: string;
    resultHash?: string;
}
interface CandidateSnapshot extends CandidatePointer {
    baseId: string; requestRevision: number; request: string; files: FileMeta[];
}
interface CandidateFile { key: string; contentBase64: string; sha256: string }
export interface CandidateSnapshotInput {
    hash: string; baseId: string; requestRevision: number; request: string; files: FileInput[];
}
interface PreparedSnapshot {
    files: Array<FileInput & { bytes: number }>;
    metadata: FileMeta[];
    hash: string;
    baseId: string;
    requestRevision: number;
    request: string;
}
interface CandidateOutputSnapshotRecord {
    snapshotHash: string; baseId: string; requestRevision: number; request: string; files: FileMeta[];
}
interface CandidateRequest { key: string; owner: string; expectedRevisionId: string | null; pointer: CandidatePointer }
export interface CandidateResultManifest {
    runId: string;
    taskId: string;
    status: "completed" | "failed" | "disputed";
    outputSnapshotHash: string;
    artifacts: Array<{ path: string; sha256: string }>;
    traceHash: string;
}
export interface CandidatePublishPermit {
    resultId: string;
    resultHash: string;
    inputRevisionId: string;
    inputSnapshotHash: string;
    inputRevisionNumber: number;
    outputSnapshotHash: string;
}
interface CandidateRequestWithPermit extends CandidateRequest { permit?: CandidatePublishPermit }
interface CandidateResultRecord {
    key: string;
    owner: string;
    expectedRevisionId: string;
    expectedSnapshotHash: string;
    expectedRevisionNumber: number;
    resultId: string;
    resultHash: string;
    manifest: CandidateResultManifest;
    outputSnapshot: CandidateOutputSnapshotRecord;
}
interface RecordWithKey { key: string; [field: string]: unknown }

export interface CandidatePersistence {
    get(key: string): Promise<RecordWithKey | undefined>;
    putFile(item: CandidateFile): Promise<boolean>;
    commit(input: {
        pointerKey: string;
        expectedRevisionId: string | null;
        permit: CandidatePublishPermit | null;
        pointer: CandidatePointer;
        snapshot: CandidateSnapshot & { key: string };
        request: CandidateRequestWithPermit;
    }): Promise<boolean>;
    commitResult(input: {
        pointerKey: string;
        expectedRevisionId: string;
        expectedSnapshotHash: string;
        expectedRevisionNumber: number;
        result: CandidateResultRecord;
    }): Promise<boolean>;
}

const digest = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

export interface CandidateCaller { owner: string; orgId: string | null }


export interface CandidateReadInput { project: number; moduleName: string }
export interface CandidatePublishInput extends CandidateReadInput {
    expectedRevisionId: string | null;
    requestId: string;
    changeId: string;
    revisionId: string;
    snapshot: CandidateSnapshotInput;
    permit?: CandidatePublishPermit;
}
export interface CandidateMarkResultInput extends CandidateReadInput {
    expectedRevisionId: string;
    expectedSnapshotHash: string;
    expectedRevisionNumber: number;
    resultId: string;
    resultHash: string;
    result: CandidateResultManifest;
    outputSnapshot: CandidateSnapshotInput;
}
export interface CandidateResponse {
    statusCode: number;
    status: "committed" | "marked" | "conflict" | "read" | "error";
    pointer?: CandidatePointer | null;
    snapshot?: CandidateSnapshotInput;
    result?: { resultRevisionId: string; resultSnapshotHash: string; resultRevisionNumber: number; resultId: string; resultHash: string; manifest: CandidateResultManifest };
    msg?: string;
}

class CandidateError extends Error {
    constructor(readonly statusCode: number, readonly code: string) { super(code); }
}
const requireToken = (value: unknown, pattern: RegExp): string => {
    if (typeof value !== "string" || !pattern.test(value)) throw new CandidateError(400, "candidate.invalid_identifier");
    return value;
};
const requireScope = (input: CandidateReadInput): { project: number; moduleName: string } => {
    if (!Number.isSafeInteger(input.project) || input.project <= 0) throw new CandidateError(400, "candidate.invalid_project");
    return { project: input.project, moduleName: requireToken(input.moduleName, MODULE) };
};
const rootOf = (project: number, moduleName: string): string => `candidate/${project}/${moduleName}`;
const pointerKeyOf = (root: string): string => `${root}/active`;
const snapshotKeyOf = (root: string, changeId: string, revisionId: string): string =>
    `${root}/changes/${changeId}/revisions/${revisionId}/snapshot`;
const fileKeyOf = (root: string, changeId: string, revisionId: string, path: string): string =>
    `${root}/changes/${changeId}/revisions/${revisionId}/files/${path}`;
const resultKeyOf = (root: string, resultId: string): string => `${root}/results/${resultId}`;
const resultOutputFileKeyOf = (root: string, resultId: string, path: string): string =>
    `${root}/results/${resultId}/output/files/${path}`;

function parsePointer(item: RecordWithKey | undefined): CandidatePointer | null {
    if (!item) return null;
    if (typeof item.changeId !== "string" || !TOKEN.test(item.changeId) ||
        typeof item.revisionId !== "string" || !TOKEN.test(item.revisionId) ||
        typeof item.snapshotHash !== "string" || !HASH.test(item.snapshotHash) ||
        !Number.isSafeInteger(item.revisionNumber) || (item.revisionNumber as number) < 1) {
        throw new CandidateError(503, "candidate.corrupt_pointer");
    }
    const hasResult = item.resultRevisionId !== undefined || item.resultSnapshotHash !== undefined ||
        item.resultRevisionNumber !== undefined || item.resultId !== undefined || item.resultHash !== undefined;
    if (hasResult && (typeof item.resultRevisionId !== "string" || !TOKEN.test(item.resultRevisionId) ||
        typeof item.resultSnapshotHash !== "string" || !HASH.test(item.resultSnapshotHash) ||
        !Number.isSafeInteger(item.resultRevisionNumber) || (item.resultRevisionNumber as number) < 1 ||
        typeof item.resultId !== "string" || !TOKEN.test(item.resultId) ||
        typeof item.resultHash !== "string" || !HASH.test(item.resultHash) ||
        item.resultRevisionId !== item.revisionId || item.resultSnapshotHash !== item.snapshotHash ||
        item.resultRevisionNumber !== item.revisionNumber)) {
        throw new CandidateError(503, "candidate.corrupt_pointer");
    }
    return {
        changeId: item.changeId, revisionId: item.revisionId,
        snapshotHash: item.snapshotHash, revisionNumber: item.revisionNumber,
        ...(hasResult ? {
            resultRevisionId: item.resultRevisionId,
            resultSnapshotHash: item.resultSnapshotHash,
            resultRevisionNumber: item.resultRevisionNumber,
            resultId: item.resultId,
            resultHash: item.resultHash,
        } : {}),
    } as CandidatePointer;
}

function authorizeCaller(caller: CandidateCaller, hubOrgId: string | null): { owner: string } {
    const owner = caller?.owner;
    if (typeof owner !== "string" || owner.length === 0 || owner.length > 200) {
        throw new CandidateError(401, "candidate.unauthorized");
    }
    if (hubOrgId === null) throw new CandidateError(503, "candidate.hub_org_unavailable");
    if (caller.orgId !== hubOrgId) throw new CandidateError(403, "candidate.forbidden");
    return { owner };
}

function manifestHash(snapshot: Pick<CandidateSnapshot, "baseId" | "requestRevision" | "request" | "files">): string {
    return digest(JSON.stringify({
        baseId: snapshot.baseId, requestRevision: snapshot.requestRevision,
        request: snapshot.request, files: snapshot.files,
    }));
}

function prepareResult(input: Pick<CandidateMarkResultInput, "result" | "resultHash">): CandidateResultManifest {
    if (!input.result || typeof input.result !== "object" || !HASH.test(input.resultHash)) {
        throw new CandidateError(400, "candidate.invalid_result");
    }
    const runId = requireToken(input.result.runId, TOKEN);
    const taskId = requireToken(input.result.taskId, TOKEN);
    if (!HASH.test(input.result.traceHash) || !HASH.test(input.result.outputSnapshotHash) ||
        !["completed", "failed", "disputed"].includes(input.result.status) ||
        !Array.isArray(input.result.artifacts) || input.result.artifacts.length > 80 ||
        (input.result.status === "completed" && input.result.artifacts.length === 0)) {
        throw new CandidateError(400, "candidate.invalid_result");
    }
    const seen = new Set<string>();
    const artifacts = input.result.artifacts.map((artifact) => {
        if (!artifact || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
            throw new CandidateError(400, "candidate.invalid_result_artifact");
        }
        const pathValid = input.result.status === "completed"
            ? isCandidateSnapshotPath(artifact.path)
            : RESULT_PATH.test(artifact.path);
        if (artifact.path.length > 180 ||
            !pathValid || artifact.path.split("/").some((part) => part === "." || part === "..") ||
            !HASH.test(artifact.sha256) || seen.has(artifact.path)) {
            throw new CandidateError(400, "candidate.invalid_result_artifact");
        }
        seen.add(artifact.path);
        return { path: artifact.path, sha256: artifact.sha256 };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (input.result.status === "completed" && CORE_PATHS.some((path) => !seen.has(path))) {
        throw new CandidateError(400, "candidate.incomplete_result_artifacts");
    }
    const manifest: CandidateResultManifest = {
        runId, taskId, status: input.result.status, outputSnapshotHash: input.result.outputSnapshotHash,
        artifacts, traceHash: input.result.traceHash,
    };
    if (digest(JSON.stringify(manifest)) !== input.resultHash) {
        throw new CandidateError(400, "candidate.invalid_result_hash");
    }
    return manifest;
}

function parsePermit(value: CandidatePublishPermit | undefined, required: boolean): CandidatePublishPermit | null {
    if (!value) {
        if (required) throw new CandidateError(409, "candidate.result_permit_required");
        return null;
    }
    if (!required) throw new CandidateError(400, "candidate.unexpected_result_permit");
    if (!TOKEN.test(value.resultId) || !HASH.test(value.resultHash) || !TOKEN.test(value.inputRevisionId) ||
        !HASH.test(value.inputSnapshotHash) || !Number.isSafeInteger(value.inputRevisionNumber) ||
        value.inputRevisionNumber < 1 || !HASH.test(value.outputSnapshotHash)) {
        throw new CandidateError(400, "candidate.invalid_result_permit");
    }
    return { ...value };
}

function samePermit(left: CandidatePublishPermit | undefined, right: CandidatePublishPermit | null): boolean {
    if (!left || !right) return !left && !right;
    return left.resultId === right.resultId && left.resultHash === right.resultHash &&
        left.inputRevisionId === right.inputRevisionId && left.inputSnapshotHash === right.inputSnapshotHash &&
        left.inputRevisionNumber === right.inputRevisionNumber &&
        left.outputSnapshotHash === right.outputSnapshotHash;
}

function sameOutputArtifacts(files: FileMeta[], artifacts: CandidateResultManifest["artifacts"]): boolean {
    const expected = files.map(({ path, sha256 }) => ({ path, sha256 }))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return JSON.stringify(expected) === JSON.stringify(artifacts);
}

function sameArtifactPaths(files: FileInput[], artifacts: CandidateResultManifest["artifacts"]): boolean {
    const inputPaths = files.map(({ path }) => path).sort();
    const outputPaths = artifacts.map(({ path }) => path).sort();
    return JSON.stringify(inputPaths) === JSON.stringify(outputPaths);
}

async function verifyPublishPermit(store: CandidatePersistence, root: string, current: CandidatePointer,
    expectedRevisionId: string, prepared: PreparedSnapshot, permit: CandidatePublishPermit): Promise<PreparedSnapshot> {
    if (permit.inputRevisionId !== expectedRevisionId || current.revisionId !== permit.inputRevisionId ||
        current.snapshotHash !== permit.inputSnapshotHash || current.revisionNumber !== permit.inputRevisionNumber ||
        current.resultId !== permit.resultId || current.resultHash !== permit.resultHash ||
        current.resultRevisionId !== permit.inputRevisionId ||
        current.resultSnapshotHash !== permit.inputSnapshotHash ||
        current.resultRevisionNumber !== permit.inputRevisionNumber) {
        throw new CandidateError(409, "candidate.result_permit_stale");
    }
    const result = await verifiedResult(store, root, current);
    const record = await store.get(resultKeyOf(root, permit.resultId)) as unknown as CandidateResultRecord | undefined;
    if (!result || !record || result.resultId !== permit.resultId || result.resultHash !== permit.resultHash ||
        result.manifest.status !== "completed" || result.manifest.outputSnapshotHash !== permit.outputSnapshotHash) {
        throw new CandidateError(409, "candidate.result_permit_mismatch");
    }
    const staged = await verifiedResultOutput(store, root, record);
    if (permit.outputSnapshotHash !== staged.hash || prepared.hash !== staged.hash ||
        prepared.baseId !== staged.baseId || prepared.requestRevision !== staged.requestRevision ||
        prepared.request !== staged.request || JSON.stringify(prepared.metadata) !== JSON.stringify(staged.metadata) ||
        !sameOutputArtifacts(staged.metadata, result.manifest.artifacts)) {
        throw new CandidateError(409, "candidate.result_permit_mismatch");
    }
    return staged;
}

function prepareSnapshot(input: { snapshot: CandidateSnapshotInput }): PreparedSnapshot {
    const files = input.snapshot?.files;
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES || !HASH.test(input.snapshot.hash)) {
        throw new CandidateError(400, "candidate.invalid_snapshot");
    }
    const baseId = requireToken(input.snapshot.baseId, TOKEN);
    const requestRevision = input.snapshot.requestRevision;
    const request = input.snapshot.request;
    if (!Number.isSafeInteger(requestRevision) || requestRevision < 0 ||
        typeof request !== "string" || Buffer.byteLength(request, "utf8") > MAX_REQUEST_BYTES) {
        throw new CandidateError(400, "candidate.invalid_request");
    }
    const seen = new Set<string>();
    let total = 0;
    const prepared = files.map((file) => {
        if (!file || typeof file.path !== "string" || !isCandidateSnapshotPath(file.path) || file.path.length > 180 ||
            seen.has(file.path) || typeof file.contentBase64 !== "string" || !HASH.test(file.sha256)) {
            throw new CandidateError(400, "candidate.invalid_file");
        }
        seen.add(file.path);
        const content = Buffer.from(file.contentBase64, "base64");
        if (content.length > MAX_FILE_BYTES) throw new CandidateError(413, "candidate.snapshot_too_large");
        if (content.length === 0 || content.toString("base64") !== file.contentBase64 ||
            digest(content) !== file.sha256) throw new CandidateError(400, "candidate.invalid_file_hash");
        total += content.length;
        if (total > MAX_SNAPSHOT_BYTES) throw new CandidateError(413, "candidate.snapshot_too_large");
        return { path: file.path, sha256: file.sha256, contentBase64: file.contentBase64, bytes: content.length };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    if (CORE_PATHS.some((path) => !seen.has(path))) throw new CandidateError(400, "candidate.incomplete_snapshot");
    const metadata = prepared.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
    const hash = manifestHash({ baseId, requestRevision, request, files: metadata });
    if (hash !== input.snapshot.hash) throw new CandidateError(400, "candidate.invalid_snapshot_hash");
    return { files: prepared, metadata, hash, baseId, requestRevision, request };
}

function outputSnapshotRecord(prepared: PreparedSnapshot): CandidateOutputSnapshotRecord {
    return {
        snapshotHash: prepared.hash, baseId: prepared.baseId, requestRevision: prepared.requestRevision,
        request: prepared.request, files: prepared.metadata,
    };
}

async function stagePreparedFiles(store: CandidatePersistence, prepared: PreparedSnapshot,
    keyOf: (path: string) => string): Promise<void> {
    for (const file of prepared.files) {
        const key = keyOf(file.path);
        const staged = await store.putFile({ key, contentBase64: file.contentBase64, sha256: file.sha256 });
        if (!staged) {
            const present = await store.get(key) as unknown as CandidateFile | undefined;
            if (!present || present.contentBase64 !== file.contentBase64 || present.sha256 !== file.sha256) {
                throw new CandidateError(409, "candidate.immutable_file_conflict");
            }
        }
    }
    for (const file of prepared.files) {
        const present = await store.get(keyOf(file.path)) as unknown as CandidateFile | undefined;
        if (!present || present.contentBase64 !== file.contentBase64 || present.sha256 !== file.sha256) {
            throw new CandidateError(503, "candidate.snapshot_unavailable");
        }
    }
}

async function verifiedResultOutput(store: CandidatePersistence, root: string,
    result: CandidateResultRecord): Promise<PreparedSnapshot> {
    const stored = result.outputSnapshot as CandidateOutputSnapshotRecord | undefined;
    if (!stored || !Array.isArray(stored.files) || stored.files.length < 1 || stored.files.length > MAX_FILES ||
        typeof stored.snapshotHash !== "string" || typeof stored.baseId !== "string" ||
        typeof stored.request !== "string") {
        throw new CandidateError(503, "candidate.corrupt_output_snapshot");
    }
    const files: FileInput[] = [];
    for (const meta of stored.files) {
        if (!meta || typeof meta.path !== "string" || typeof meta.sha256 !== "string") {
            throw new CandidateError(503, "candidate.corrupt_output_snapshot");
        }
        const file = await store.get(resultOutputFileKeyOf(root, result.resultId, meta.path)) as unknown as CandidateFile | undefined;
        if (!file || typeof file.contentBase64 !== "string" || file.sha256 !== meta.sha256) {
            throw new CandidateError(503, "candidate.output_snapshot_unavailable");
        }
        files.push({ path: meta.path, sha256: meta.sha256, contentBase64: file.contentBase64 });
    }
    let prepared: PreparedSnapshot;
    try {
        prepared = prepareSnapshot({ snapshot: {
            hash: stored.snapshotHash, baseId: stored.baseId, requestRevision: stored.requestRevision,
            request: stored.request, files,
        } });
    } catch {
        throw new CandidateError(503, "candidate.corrupt_output_snapshot");
    }
    if (JSON.stringify(prepared.metadata) !== JSON.stringify(stored.files)) {
        throw new CandidateError(503, "candidate.corrupt_output_snapshot");
    }
    return prepared;
}

async function verifiedSnapshot(store: CandidatePersistence, root: string, pointer: CandidatePointer): Promise<{
    hash: string; baseId: string; requestRevision: number; request: string; files: FileInput[];
}> {
    const item = await store.get(snapshotKeyOf(root, pointer.changeId, pointer.revisionId));
    if (!item || item.snapshotHash !== pointer.snapshotHash || !Array.isArray(item.files) || item.files.length > MAX_FILES) {
        throw new CandidateError(503, "candidate.snapshot_unavailable");
    }
    const metadata = item.files as FileMeta[];
    if (typeof item.baseId !== "string" || !TOKEN.test(item.baseId) ||
        !Number.isSafeInteger(item.requestRevision) || (item.requestRevision as number) < 0 ||
        typeof item.request !== "string" || Buffer.byteLength(item.request, "utf8") > MAX_REQUEST_BYTES) {
        throw new CandidateError(503, "candidate.corrupt_snapshot");
    }
    const manifest = { baseId: item.baseId, requestRevision: item.requestRevision as number,
        request: item.request, files: metadata };
    if (manifestHash(manifest) !== pointer.snapshotHash) throw new CandidateError(503, "candidate.corrupt_snapshot");
    if (CORE_PATHS.some((path) => !metadata.some((file) => file.path === path))) {
        throw new CandidateError(503, "candidate.corrupt_snapshot");
    }
    const files: FileInput[] = [];
    for (const meta of metadata) {
        if (!meta || typeof meta.path !== "string" || !isCandidateSnapshotPath(meta.path) ||
            !HASH.test(meta.sha256) || !Number.isSafeInteger(meta.bytes) || meta.bytes > MAX_FILE_BYTES) {
            throw new CandidateError(503, "candidate.corrupt_snapshot");
        }
        const file = await store.get(fileKeyOf(root, pointer.changeId, pointer.revisionId, meta.path)) as unknown as CandidateFile | undefined;
        if (!file || typeof file.contentBase64 !== "string") throw new CandidateError(503, "candidate.snapshot_unavailable");
        const content = Buffer.from(file.contentBase64, "base64");
        if (content.length !== meta.bytes || digest(content) !== meta.sha256 || file.contentBase64 !== content.toString("base64")) {
            throw new CandidateError(503, "candidate.corrupt_snapshot");
        }
        files.push({ path: meta.path, sha256: meta.sha256, contentBase64: file.contentBase64 });
    }
    return { hash: pointer.snapshotHash, baseId: manifest.baseId,
        requestRevision: manifest.requestRevision, request: manifest.request, files };
}

async function verifiedResult(store: CandidatePersistence, root: string, pointer: CandidatePointer): Promise<CandidateResponse["result"]> {
    if (!pointer.resultRevisionId || !pointer.resultId || !pointer.resultHash) return undefined;
    const item = await store.get(resultKeyOf(root, pointer.resultId)) as unknown as CandidateResultRecord | undefined;
    if (!item || item.expectedRevisionId !== pointer.resultRevisionId ||
        item.expectedSnapshotHash !== pointer.resultSnapshotHash ||
        item.expectedRevisionNumber !== pointer.resultRevisionNumber || item.resultId !== pointer.resultId ||
        item.resultHash !== pointer.resultHash || !item.manifest) {
        throw new CandidateError(503, "candidate.result_unavailable");
    }
    let manifest: CandidateResultManifest;
    try {
        manifest = prepareResult({ resultHash: pointer.resultHash, result: item.manifest });
    } catch {
        throw new CandidateError(503, "candidate.corrupt_result");
    }
    const output = await verifiedResultOutput(store, root, item);
    if (manifest.outputSnapshotHash !== output.hash ||
        (manifest.status === "completed" && !sameOutputArtifacts(output.metadata, manifest.artifacts))) {
        throw new CandidateError(503, "candidate.corrupt_result");
    }
    return {
        resultRevisionId: pointer.resultRevisionId, resultSnapshotHash: pointer.resultSnapshotHash,
        resultRevisionNumber: pointer.resultRevisionNumber, resultId: pointer.resultId,
        resultHash: pointer.resultHash, manifest,
    };
}

function errorResponse(error: unknown): CandidateResponse {
    if (error instanceof CandidateError) return { statusCode: error.statusCode, status: "error", msg: error.code };
    // Storage errors are not a conflict and must never be reported as success.
    return { statusCode: 503, status: "error", msg: "candidate.storage_unavailable" };
}

export async function candidateRead(caller: CandidateCaller, input: CandidateReadInput, hubOrgId: string | null, store: CandidatePersistence): Promise<CandidateResponse> {
    try {
        const { project, moduleName } = requireScope(input);
        await authorizeCaller(caller, hubOrgId);
        const root = rootOf(project, moduleName);
        const pointerKey = pointerKeyOf(root);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const pointer = parsePointer(await store.get(pointerKey));
            if (!pointer) {
                await authorizeCaller(caller, hubOrgId);
                const confirmed = parsePointer(await store.get(pointerKey));
                if (!confirmed) return { statusCode: 200, status: "read", pointer: null };
                if (attempt === 0) continue;
                throw new CandidateError(409, "candidate.revision_changed");
            }
            const snapshot = await verifiedSnapshot(store, root, pointer);
            const result = await verifiedResult(store, root, pointer);
            await authorizeCaller(caller, hubOrgId);
            const confirmed = parsePointer(await store.get(pointerKey));
            if (confirmed && JSON.stringify(confirmed) === JSON.stringify(pointer)) {
                return { statusCode: 200, status: "read", pointer, snapshot, ...(result ? { result } : {}) };
            }
            if (attempt === 1) throw new CandidateError(409, "candidate.revision_changed");
        }
        throw new CandidateError(409, "candidate.revision_changed");
    } catch (error) { return errorResponse(error); }
}

export async function candidatePublish(caller: CandidateCaller, input: CandidatePublishInput, hubOrgId: string | null, store: CandidatePersistence): Promise<CandidateResponse> {
    try {
        const fixed = frozenClone(input);
        const { project, moduleName } = requireScope(fixed);
        const changeId = requireToken(fixed.changeId, TOKEN);
        const revisionId = requireToken(fixed.revisionId, TOKEN);
        const requestId = requireToken(fixed.requestId, TOKEN);
        if (fixed.expectedRevisionId !== null) requireToken(fixed.expectedRevisionId, TOKEN);
        let prepared = prepareSnapshot(fixed);
        const permit = parsePermit(fixed.permit, fixed.expectedRevisionId !== null);
        const access = await authorizeCaller(caller, hubOrgId);
        const root = rootOf(project, moduleName);
        const pointerKey = pointerKeyOf(root);
        const requestKey = `${root}/requests/${requestId}`;
        const existingRequest = await store.get(requestKey) as unknown as CandidateRequestWithPermit | undefined;
        if (existingRequest) {
            if (existingRequest.owner !== access.owner || existingRequest.expectedRevisionId !== fixed.expectedRevisionId ||
                existingRequest.pointer?.changeId !== changeId || existingRequest.pointer?.revisionId !== revisionId ||
                existingRequest.pointer?.snapshotHash !== prepared.hash || !samePermit(existingRequest.permit, permit)) {
                throw new CandidateError(409, "candidate.request_reused");
            }
            await verifiedSnapshot(store, root, existingRequest.pointer);
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 200, status: "committed", pointer: existingRequest.pointer };
        }
        const current = parsePointer(await store.get(pointerKey));
        if ((current?.revisionId ?? null) !== fixed.expectedRevisionId) {
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 409, status: "conflict", pointer: current };
        }
        if (fixed.expectedRevisionId !== null) {
            if (!current || !permit) throw new CandidateError(409, "candidate.result_permit_required");
            prepared = await verifyPublishPermit(store, root, current, fixed.expectedRevisionId, prepared, permit);
        }
        const pointer: CandidatePointer = {
            changeId, revisionId, snapshotHash: prepared.hash, revisionNumber: (current?.revisionNumber ?? 0) + 1,
        };
        // Staging is immutable and isolated. A failed commit may leave recoverable orphan files.
        await stagePreparedFiles(store, prepared, path => fileKeyOf(root, changeId, revisionId, path));
        const committed = await store.commit({
            pointerKey, expectedRevisionId: fixed.expectedRevisionId, permit, pointer,
            snapshot: { key: snapshotKeyOf(root, changeId, revisionId), ...pointer,
                baseId: prepared.baseId, requestRevision: prepared.requestRevision,
                request: prepared.request, files: prepared.metadata },
            request: { key: requestKey, owner: access.owner, expectedRevisionId: fixed.expectedRevisionId,
                pointer, ...(permit ? { permit } : {}) },
        });
        if (committed) {
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 200, status: "committed", pointer };
        }
        // A timeout/cancel may hide a successful commit. Re-read the idempotency key first.
        const after = await store.get(requestKey) as unknown as CandidateRequestWithPermit | undefined;
        if (after) {
            if (after.owner !== access.owner || after.expectedRevisionId !== fixed.expectedRevisionId ||
                after.pointer?.snapshotHash !== prepared.hash || after.pointer?.revisionId !== revisionId ||
                after.pointer?.changeId !== changeId || !samePermit(after.permit, permit)) {
                throw new CandidateError(409, "candidate.request_reused");
            }
            await verifiedSnapshot(store, root, after.pointer);
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 200, status: "committed", pointer: after.pointer };
        }
        const winner = parsePointer(await store.get(pointerKey));
        await authorizeCaller(caller, hubOrgId);
        return { statusCode: 409, status: "conflict", pointer: winner };
    } catch (error) { return errorResponse(error); }
}

function sameResult(record: CandidateResultRecord | undefined, expected: CandidateResultRecord): boolean {
    return Boolean(record && record.owner === expected.owner &&
        record.expectedRevisionId === expected.expectedRevisionId &&
        record.expectedSnapshotHash === expected.expectedSnapshotHash &&
        record.expectedRevisionNumber === expected.expectedRevisionNumber && record.resultId === expected.resultId &&
        record.resultHash === expected.resultHash && JSON.stringify(record.manifest) === JSON.stringify(expected.manifest) &&
        JSON.stringify(record.outputSnapshot) === JSON.stringify(expected.outputSnapshot));
}

export async function candidateMarkResult(caller: CandidateCaller, input: CandidateMarkResultInput, hubOrgId: string | null,
    store: CandidatePersistence): Promise<CandidateResponse> {
    try {
        const fixed = frozenClone(input);
        const { project, moduleName } = requireScope(fixed);
        const expectedRevisionId = requireToken(fixed.expectedRevisionId, TOKEN);
        const expectedSnapshotHash = requireToken(fixed.expectedSnapshotHash, HASH);
        if (!Number.isSafeInteger(fixed.expectedRevisionNumber) || fixed.expectedRevisionNumber < 1) {
            throw new CandidateError(400, "candidate.invalid_revision_number");
        }
        const expectedRevisionNumber = fixed.expectedRevisionNumber;
        const resultId = requireToken(fixed.resultId, TOKEN);
        const manifest = prepareResult(fixed);
        const preparedOutput = prepareSnapshot({ snapshot: fixed.outputSnapshot });
        if (manifest.outputSnapshotHash !== preparedOutput.hash) {
            throw new CandidateError(400, "candidate.result_output_mismatch");
        }
        const access = await authorizeCaller(caller, hubOrgId);
        const root = rootOf(project, moduleName);
        const pointerKey = pointerKeyOf(root);
        const resultKey = resultKeyOf(root, resultId);
        const result: CandidateResultRecord = {
            key: resultKey, owner: access.owner, expectedRevisionId, expectedSnapshotHash, expectedRevisionNumber,
            resultId, resultHash: fixed.resultHash, manifest, outputSnapshot: outputSnapshotRecord(preparedOutput),
        };
        const current = parsePointer(await store.get(pointerKey));
        if (!current || current.revisionId !== expectedRevisionId || current.snapshotHash !== expectedSnapshotHash ||
            current.revisionNumber !== expectedRevisionNumber) {
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 409, status: "conflict", pointer: current };
        }
        const inputSnapshot = await verifiedSnapshot(store, root, current);
        if (manifest.status === "completed") {
            if (!sameArtifactPaths(inputSnapshot.files, preparedOutput.files) ||
                !sameArtifactPaths(inputSnapshot.files, manifest.artifacts)) {
                throw new CandidateError(400, "candidate.result_artifact_paths_mismatch");
            }
            if (!sameOutputArtifacts(preparedOutput.metadata, manifest.artifacts)) {
                throw new CandidateError(400, "candidate.result_output_mismatch");
            }
        }
        await stagePreparedFiles(store, preparedOutput, path => resultOutputFileKeyOf(root, resultId, path));
        const priorResult = await store.get(resultKey) as unknown as CandidateResultRecord | undefined;
        if (priorResult) {
            if (!sameResult(priorResult, result)) throw new CandidateError(409, "candidate.result_reused");
            const latest = parsePointer(await store.get(pointerKey));
            await authorizeCaller(caller, hubOrgId);
            if (latest?.revisionId === expectedRevisionId && latest.snapshotHash === expectedSnapshotHash &&
                latest.revisionNumber === expectedRevisionNumber && latest.resultId === resultId &&
                latest.resultHash === fixed.resultHash && latest.resultRevisionId === expectedRevisionId) {
                return { statusCode: 200, status: "marked", pointer: latest };
            }
            return { statusCode: 409, status: "conflict", pointer: latest };
        }
        if (current.resultId) {
            await authorizeCaller(caller, hubOrgId);
            return { statusCode: 409, status: "conflict", pointer: current };
        }
        const committed = await store.commitResult({
            pointerKey, expectedRevisionId, expectedSnapshotHash, expectedRevisionNumber, result,
        });
        const latest = parsePointer(await store.get(pointerKey));
        const durableResult = await store.get(resultKey) as unknown as CandidateResultRecord | undefined;
        await authorizeCaller(caller, hubOrgId);
        if ((committed || sameResult(durableResult, result)) && latest?.revisionId === expectedRevisionId &&
            latest.snapshotHash === expectedSnapshotHash && latest.revisionNumber === expectedRevisionNumber &&
            latest.resultRevisionId === expectedRevisionId && latest.resultId === resultId && latest.resultHash === fixed.resultHash) {
            return { statusCode: 200, status: "marked", pointer: latest };
        }
        return { statusCode: 409, status: "conflict", pointer: latest };
    } catch (error) { return errorResponse(error); }
}

/** `/exec` action handler, kept independently testable from the legacy action registry. */
export async function handleCandidateRevision(caller: CandidateCaller, input: ({ action: "candidateRead" } & CandidateReadInput) |
    ({ action: "candidatePublish" } & CandidatePublishInput) |
    ({ action: "candidateMarkResult" } & CandidateMarkResultInput),
    hubOrgId: string | null, store: CandidatePersistence): Promise<CandidateResponse> {
    if (input.action === "candidateRead") return candidateRead(caller, input, hubOrgId, store);
    if (input.action === "candidatePublish") return candidatePublish(caller, input, hubOrgId, store);
    return candidateMarkResult(caller, input, hubOrgId, store);
}
