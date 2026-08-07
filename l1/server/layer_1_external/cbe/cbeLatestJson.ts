/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeLatestJson.ts" enhancement="_blank" />
// Runtime-VM port of the central cbe latest.json routine (cbe-collab-back-end
// staticFilesS3.loadAndUpdateCache): the lib/monaco/www versions live in
// s3://www.collab.codes/latest.json and the cbe fetches them at Node startup.
// The VM holds no AWS credentials, so it reads the PUBLIC https endpoint and
// caches the payload on disk (same static dir as /libs/*) — offline restarts
// keep the last known versions. The boot HTML injects the parsed object as
// window.latest (see startServer injectBootConfig), exactly like the studio's
// index.html, so the client can load versioned libs:
//   window.latest = {"www":"...","libs":"20260731135026","monaco":"...",...}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getCbeStaticDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.js';

// Public read of the same bucket the central cbe uses (bucketName in
// staticFilesS3.ts); https://www.collab.codes/latest.json itself is rewritten
// to the SPA index, so the raw S3 endpoint is the stable address.
const DEFAULT_LATEST_URL = 'https://s3.amazonaws.com/www.collab.codes/latest.json';

let lastLatestJson = ''; // cache — raw JSON string, '' while unavailable

function getLatestUrl(): string {
  return process.env.CBE_LATEST_URL ?? DEFAULT_LATEST_URL;
}

function getDiskPath(): string {
  return join(getCbeStaticDir(), 'latest.json');
}

/** Raw latest.json payload ('' when never fetched and no disk copy). */
export function getLatestJson(): string {
  return lastLatestJson;
}

function loadFromDisk(): void {
  try {
    const diskPath = getDiskPath();
    if (!existsSync(diskPath)) return;
    const content = readFileSync(diskPath, 'utf8');
    JSON.parse(content); // corrupt file must not poison the boot HTML
    lastLatestJson = content;
  } catch {
    // unreadable/corrupt — remote fetch below is the recovery path
  }
}

async function fetchFromRemote(): Promise<void> {
  const url = getLatestUrl();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[cbe] latest.json remote miss ${url} -> ${response.status}`);
      return;
    }
    const content = await response.text();
    JSON.parse(content);
    lastLatestJson = content;
    try {
      const diskPath = getDiskPath();
      mkdirSync(dirname(diskPath), { recursive: true });
      writeFileSync(diskPath, content, 'utf8');
    } catch (err) {
      console.error(`[cbe] latest.json disk write error:`, (err as Error).message);
    }
  } catch (err) {
    console.error(`[cbe] latest.json fetch error ${url}:`, (err as Error).message);
  }
}

/**
 * Startup init, same shape as the central cbe: disk copy first (instant,
 * survives offline restarts), then the remote refresh. Fire-and-forget from
 * the server bootstrap — requests arriving before the fetch completes simply
 * get the disk version (or no window.latest on the very first boot).
 */
export function initCbeLatestJson(): void {
  loadFromDisk();
  void fetchFromRemote().then(() => {
    console.info(`[cbe] latest.json ready: ${lastLatestJson || '(unavailable)'}`);
  });
}
