/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeUploads.ts" enhancement="_blank" />
// Big files for setContents (rt189): a file may arrive compressed (`gzip-base64`) and/or in parts.
//
// WHY: the body of one /exec request stays at 4 MB (nginx and EXEC_BODY_LIMIT). The Studio's New Release outputs (12 and
// 4 MB) do not fit, so a file travels as gzip-base64, and a file that still does not fit travels in parts
// (`setContentsPart`, at most 3 MB of text each) that `setContents` joins. Everything is decoded, checked and assembled
// BEFORE the first write of the request, so a bad file leaves nothing half done.
//
// WHERE: the parts are kept outside the git tree, per project and per draft:
//   <base>/.cbe-uploads/<project>/<draft slug>/<uploadId>/<index>   (+ meta.json with `total`)
// An upload is valid for one hour after its last part; expired ones are removed on the next part/setContents of the
// project, and the ones a setContents used are removed after it wrote.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { CbeSourceEncoding, CbeSourceFileInput } from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

/** Most bytes one file may have once assembled and decompressed. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Most characters one part may carry (a 4 MB request has room for it plus the envelope). */
export const MAX_PART_CHARS = 3 * 1024 * 1024;
export const MAX_PARTS = 64;
/** The base64 of a 64 MB file: no upload may accumulate more text than a 64 MB file can need. */
export const MAX_UPLOAD_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3);
export const UPLOAD_TTL_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;
const ENCODINGS: ReadonlySet<string> = new Set(['utf8', 'base64', 'gzip-base64']);

/** A file ready to write: its bytes, decoded and checked. */
export interface DecodedSourceFile {
  shortPath: string;
  bytes: Buffer;
}

type Failure = { ok: false; msg: string };

function uploadDir(base: string, project: number, scope: string, uploadId: string): string {
  return join(base, '.cbe-uploads', String(project), scope, uploadId);
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const name of readdirSync(dir)) newest = Math.max(newest, statSync(join(dir, name)).mtimeMs);
  return newest;
}

/** Removes the uploads of `project` whose last part is older than the validity. Never throws. */
export function sweepExpiredUploads(base: string, project: number, now: number = Date.now()): void {
  const root = join(base, '.cbe-uploads', String(project));
  if (!existsSync(root)) return;
  try {
    for (const scope of readdirSync(root)) {
      const scopeDir = join(root, scope);
      for (const id of readdirSync(scopeDir)) {
        const dir = join(scopeDir, id);
        if (now - newestMtime(dir) > UPLOAD_TTL_MS) rmSync(dir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    console.warn(`[cbe] uploads sweep (project ${project}): ${(error as Error).message}`);
  }
}

export interface PartInput {
  uploadId?: unknown;
  index?: unknown;
  total?: unknown;
  data?: unknown;
}

/** The reason a part is not acceptable, or null. */
export function partProblem(part: PartInput): string | null {
  if (typeof part.uploadId !== 'string' || !UUID.test(part.uploadId)) return 'invalid uploadId (a UUID is required)';
  if (!Number.isInteger(part.total) || (part.total as number) < 1 || (part.total as number) > MAX_PARTS) {
    return `invalid total (1..${MAX_PARTS})`;
  }
  if (!Number.isInteger(part.index) || (part.index as number) < 0 || (part.index as number) >= (part.total as number)) {
    return 'invalid index (0..total-1)';
  }
  if (typeof part.data !== 'string') return 'invalid data';
  if (part.data.length > MAX_PART_CHARS) return 'part exceeds 3 MB';
  return null;
}

/** Keeps one part (a repeat of the same index overwrites it). 400-style result with the reason, never a partial state. */
export function storePart(
  base: string,
  project: number,
  scope: string,
  part: { uploadId: string; index: number; total: number; data: string },
): { ok: true; received: number } | Failure {
  const dir = uploadDir(base, project, scope, part.uploadId);
  const metaFile = join(dir, 'meta.json');
  if (existsSync(metaFile)) {
    const declared = (JSON.parse(readFileSync(metaFile, 'utf8')) as { total: number }).total;
    if (declared !== part.total) return { ok: false, msg: `upload ${part.uploadId}: total changed (${declared} declared, ${part.total} sent)` };
  }
  let accumulated = part.data.length;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name === 'meta.json' || name === String(part.index)) continue;
      accumulated += statSync(join(dir, name)).size;
    }
  }
  if (accumulated > MAX_UPLOAD_CHARS) {
    return { ok: false, msg: `upload ${part.uploadId}: exceeds 64 MB` };
  }
  mkdirSync(dir, { recursive: true });
  if (!existsSync(metaFile)) writeFileSync(metaFile, JSON.stringify({ total: part.total }));
  writeFileSync(join(dir, String(part.index)), part.data, 'utf8');
  const received = readdirSync(dir).filter((name) => name !== 'meta.json').length;
  return { ok: true, received };
}

/** The text of an upload: parts 0..total-1 joined in order, or the reason it cannot be assembled. */
function assemble(base: string, project: number, scope: string, uploadId: string, now: number): { ok: true; text: string } | Failure {
  if (!UUID.test(uploadId)) return { ok: false, msg: `upload ${uploadId}: invalid uploadId (a UUID is required)` };
  const dir = uploadDir(base, project, scope, uploadId);
  const metaFile = join(dir, 'meta.json');
  if (!existsSync(metaFile)) return { ok: false, msg: `upload ${uploadId}: unknown` };
  if (now - newestMtime(dir) > UPLOAD_TTL_MS) return { ok: false, msg: `upload ${uploadId}: expired` };
  const total = (JSON.parse(readFileSync(metaFile, 'utf8')) as { total: number }).total;
  const parts: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const file = join(dir, String(index));
    if (!existsSync(file)) return { ok: false, msg: `upload ${uploadId}: missing part ${index}` };
    parts.push(readFileSync(file, 'utf8'));
  }
  return { ok: true, text: parts.join('') };
}

/** The bytes of a text in the given encoding, with the 64 MB ceiling (also on what a gzip inflates to). */
export function decodeText(shortPath: string, text: string, encoding: CbeSourceEncoding | undefined): { ok: true; bytes: Buffer } | Failure {
  const kind = encoding ?? 'utf8';
  if (!ENCODINGS.has(kind)) return { ok: false, msg: `file ${shortPath}: unknown encoding ${String(encoding)}` };
  let bytes: Buffer;
  if (kind === 'utf8') {
    bytes = Buffer.from(text, 'utf8');
  } else if (kind === 'base64') {
    bytes = Buffer.from(text, 'base64');
  } else {
    try {
      // maxOutputLength: a small gzip must not inflate past the ceiling and eat the memory
      bytes = gunzipSync(Buffer.from(text, 'base64'), { maxOutputLength: MAX_FILE_BYTES });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ERR_BUFFER_TOO_LARGE' || (error as Error).name === 'RangeError'
        ? { ok: false, msg: `file ${shortPath} exceeds 64 MB` }
        : { ok: false, msg: `file ${shortPath}: invalid gzip` };
    }
  }
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, msg: `file ${shortPath} exceeds 64 MB` };
  return { ok: true, bytes };
}

/**
 * Every file of a setContents, decoded and checked (uploads assembled, sha256 compared) before anything is written.
 * `uploadIds` lists the uploads it used, for the caller to remove after the write.
 */
export function decodeSourceInputs(
  files: CbeSourceFileInput[],
  where: { base: string; project: number; scope: string; now?: number },
): { ok: true; files: DecodedSourceFile[]; uploadIds: string[] } | Failure {
  const now = where.now ?? Date.now();
  const decoded: DecodedSourceFile[] = [];
  const uploadIds: string[] = [];
  for (const file of files) {
    if (file === null || typeof file !== 'object' || typeof file.shortPath !== 'string') {
      return { ok: false, msg: 'invalid file entry (shortPath is required)' };
    }
    if ('uploadId' in file && file.uploadId !== undefined) {
      const joined = assemble(where.base, where.project, where.scope, file.uploadId, now);
      if (!joined.ok) return joined;
      const bytes = decodeText(file.shortPath, joined.text, file.encoding);
      if (!bytes.ok) return bytes;
      if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) {
        return { ok: false, msg: `upload ${file.uploadId}: sha256 is required (64 hex chars)` };
      }
      if (createHash('sha256').update(bytes.bytes).digest('hex') !== file.sha256.toLowerCase()) {
        return { ok: false, msg: `upload ${file.uploadId}: sha256 mismatch` };
      }
      decoded.push({ shortPath: file.shortPath, bytes: bytes.bytes });
      uploadIds.push(file.uploadId);
      continue;
    }
    if (typeof (file as { content?: unknown }).content !== 'string') {
      return { ok: false, msg: `file ${file.shortPath}: content or uploadId is required` };
    }
    const bytes = decodeText(file.shortPath, (file as { content: string }).content, file.encoding);
    if (!bytes.ok) return bytes;
    decoded.push({ shortPath: file.shortPath, bytes: bytes.bytes });
  }
  return { ok: true, files: decoded, uploadIds };
}

/** Removes the uploads a setContents used. Never throws: the files are already written. */
export function removeUploads(base: string, project: number, scope: string, uploadIds: string[]): void {
  for (const id of uploadIds) {
    try {
      rmSync(uploadDir(base, project, scope, id), { recursive: true, force: true });
    } catch (error) {
      console.warn(`[cbe] upload ${id}: not removed (${(error as Error).message})`);
    }
  }
}
