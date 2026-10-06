/// <mls fileReference="_102034_/l1/server/layer_1_external/candidate/candidatePostgres.ts" enhancement="_blank" />
import type { Pool, PoolClient } from "pg";
import type { CandidatePersistence } from "/_102034_/l1/server/layer_1_external/candidate/candidateStore.js";

type CommitInput = Parameters<CandidatePersistence["commit"]>[0];
type CommitResultInput = Parameters<CandidatePersistence["commitResult"]>[0];
type PointerRecord = { key: string; [field: string]: unknown } | undefined;

const SCHEMA_DDL = "CREATE SCHEMA IF NOT EXISTS collab_candidate";
const TABLE_DDL = `CREATE TABLE IF NOT EXISTS collab_candidate.records (
  key text PRIMARY KEY,
  item jsonb NOT NULL
)`;

export async function ensureCandidateSchema(pool: Pool): Promise<void> {
    await pool.query(SCHEMA_DDL);
    await pool.query(TABLE_DDL);
}

/** Pointer condition of the legacy commit: absent key on first publish, else the eight-field update check. */
export function commitAllowed(currentPointer: PointerRecord, input: CommitInput): boolean {
    if (input.expectedRevisionId === null) return currentPointer === undefined;
    const permit = input.permit;
    if (!currentPointer || !permit) return false;
    const prior = input.pointer.revisionNumber - 1;
    const expected = input.expectedRevisionId;
    const expectedHash = permit.inputSnapshotHash;
    return currentPointer.revisionId === expected
        && currentPointer.snapshotHash === expectedHash
        && currentPointer.revisionNumber === prior
        && currentPointer.resultRevisionId === expected
        && currentPointer.resultSnapshotHash === expectedHash
        && currentPointer.resultRevisionNumber === prior
        && currentPointer.resultId === permit.resultId
        && currentPointer.resultHash === permit.resultHash;
}

/** Pointer condition of the legacy commitResult, including attribute_not_exists(resultId). */
export function commitResultAllowed(currentPointer: PointerRecord, input: CommitResultInput): boolean {
    if (!currentPointer) return false;
    if (Object.prototype.hasOwnProperty.call(currentPointer, "resultId")) return false;
    return currentPointer.revisionId === input.expectedRevisionId
        && currentPointer.snapshotHash === input.expectedSnapshotHash
        && currentPointer.revisionNumber === input.expectedRevisionNumber;
}

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

async function readPointer(client: PoolClient, key: string): Promise<PointerRecord> {
    const result = await client.query(
        "SELECT item FROM collab_candidate.records WHERE key = $1 FOR UPDATE",
        [key],
    );
    const item = result.rows[0]?.item as Record<string, unknown> | undefined;
    if (!item) return undefined;
    return { ...item, key };
}

async function insertNew(client: PoolClient, item: { key: string }): Promise<boolean> {
    try {
        await client.query(
            "INSERT INTO collab_candidate.records (key, item) VALUES ($1, $2::jsonb)",
            [item.key, JSON.stringify(item)],
        );
        return true;
    } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
    }
}

async function upsertItem(client: PoolClient, item: { key: string }): Promise<void> {
    await client.query(
        `INSERT INTO collab_candidate.records (key, item) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET item = EXCLUDED.item`,
        [item.key, JSON.stringify(item)],
    );
}

export class PostgresCandidatePersistence implements CandidatePersistence {
    constructor(private readonly pool: Pool) {}

    async get(key: string): Promise<{ key: string; [field: string]: unknown } | undefined> {
        const result = await this.pool.query(
            "SELECT item FROM collab_candidate.records WHERE key = $1",
            [key],
        );
        const item = result.rows[0]?.item as Record<string, unknown> | undefined;
        if (!item) return undefined;
        return { ...item, key };
    }

    async putFile(item: { key: string; contentBase64: string; sha256: string }): Promise<boolean> {
        const result = await this.pool.query(
            "INSERT INTO collab_candidate.records (key, item) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING",
            [item.key, JSON.stringify(item)],
        );
        return result.rowCount === 1;
    }

    async commit(input: CommitInput): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const current = await readPointer(client, input.pointerKey);
            if (!commitAllowed(current, input)) {
                await client.query("ROLLBACK");
                return false;
            }
            if (!await insertNew(client, input.snapshot) || !await insertNew(client, input.request)) {
                await client.query("ROLLBACK");
                return false;
            }
            const pointerItem = { key: input.pointerKey, ...input.pointer };
            const wrotePointer = input.expectedRevisionId === null
                ? await insertNew(client, pointerItem)
                : await upsertItem(client, pointerItem).then(() => true);
            if (!wrotePointer) {
                await client.query("ROLLBACK");
                return false;
            }
            await client.query("COMMIT");
            return true;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async commitResult(input: CommitResultInput): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const current = await readPointer(client, input.pointerKey);
            if (!commitResultAllowed(current, input)) {
                await client.query("ROLLBACK");
                return false;
            }
            if (!await insertNew(client, input.result)) {
                await client.query("ROLLBACK");
                return false;
            }
            const pointerItem = {
                ...current,
                key: input.pointerKey,
                resultRevisionId: input.expectedRevisionId,
                resultSnapshotHash: input.expectedSnapshotHash,
                resultRevisionNumber: input.expectedRevisionNumber,
                resultId: input.result.resultId,
                resultHash: input.result.resultHash,
            };
            await upsertItem(client, pointerItem);
            await client.query("COMMIT");
            return true;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
}
