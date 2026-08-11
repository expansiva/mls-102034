/// <mls fileReference="_102034_/l1/server/layer_1_external/cbe/cbeStaticFiles.ts" enhancement="_blank" />
// Static delivery of the mls lib files (/libs/*, /monaco/*, /mlsServiceWorker.js),
// same strategy as the central cbe: local disk cache first, remote origin on miss
// (the origin is backed by the S3 bucket the cbe publishes to). The runtime VM
// never holds AWS credentials — it reaches the assets over HTTPS and caches
// them on disk, so repeated requests never leave the machine.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import {
  CBE_HTTP_BAD_REQUEST,
  CBE_HTTP_NOT_FOUND,
  CBE_HTTP_NOT_MODIFIED,
  CBE_HTTP_OK,
} from '/_102034_/l1/server/layer_1_external/cbe/cbeTypes.js';

const DEFAULT_REMOTE_ORIGIN = 'https://on.collab.codes';

export interface CbeStaticFileResult {
  statusCode: number;
  content?: Buffer;
  eTag?: string;
  contentType?: string;
  msg?: string;
}

// Standard VM layout: /data/mls-base is the deployment base; static/, current
// (symlink) and releases/ are siblings inside it. The static cache always lives
// at the base, never inside a release.
const DEFAULT_STATIC_DIR = '/data/mls-base/static';

/** Shared with cbeLatestJson (latest.json lives beside the /libs/* cache). */
export function getCbeStaticDir(): string {
  return getStaticDir();
}

function getStaticDir(): string {
  // Explicit override wins (CBE_STATIC_DIR in the .env / pm2 env).
  const fromEnv = process.env.CBE_STATIC_DIR;
  if (fromEnv) return resolve(fromEnv);

  // Default: the standard VM location.
  if (existsSync(DEFAULT_STATIC_DIR)) return DEFAULT_STATIC_DIR;

  // Dev workspace (no /data): <projectsDir>/static.
  return resolveProjectsPath('static');
}

function getRemoteOrigin(): string {
  return (process.env.CBE_STATIC_ORIGIN ?? DEFAULT_REMOTE_ORIGIN).replace(/\/+$/u, '');
}

function isAllowedPath(urlPath: string): boolean {
  return urlPath.startsWith('/libs/') || urlPath.startsWith('/monaco/') || urlPath === '/mlsServiceWorker.js';
}

function getContentTypeByExtension(urlPath: string): string {
  if (urlPath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (urlPath.endsWith('.map') || urlPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (urlPath.endsWith('.d.ts') || urlPath.endsWith('.ts')) return 'text/plain; charset=utf-8';
  if (urlPath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (urlPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (urlPath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (urlPath.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function readFromDisk(filePath: string): Buffer | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const data = readFileSync(filePath);
    return data.length > 0 ? data : undefined;
  } catch {
    return undefined;
  }
}

async function fetchFromRemote(urlPath: string): Promise<Buffer | undefined> {
  const url = `${getRemoteOrigin()}${urlPath}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[cbe] static remote miss ${url} -> ${response.status}`);
      return undefined;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error(`[cbe] static remote error ${url}:`, (err as Error).message);
    return undefined;
  }
}

function computeETag(content: Buffer): string {
  return `${createHash('sha1').update(content).digest('base64')}a`;
}

// ── Runtime patch of the studio service worker ──────────────────────────────
// The studio SW answers a synthetic 404 on cache miss — correct on
// on.collab.codes (the cache IS the only source: login fills it before any
// widget import), wrong on the runtime VM, where the server itself serves
// every /_<id>_/l2/* from dist + compiled.zip. A registered SW with a cleared
// cache (user wipes site data) would 404 every module until the next login
// completes. Patch at SERVE time (the disk/remote copy stays pristine, so
// upstream refreshes keep working): on miss, try the network before 404ing.
const SW_MISS_ORIGINAL = `    totalNotFound += 1;
    return new Response(null, {
      status: 404,`;
const SW_MISS_PATCHED = `    totalNotFound += 1;
    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.ok) return networkResponse;
    } catch { /* offline — fall through to the 404 below */ }
    return new Response(null, {
      status: 404,`;

function patchServiceWorkerForRuntime(content: Buffer): Buffer {
  const source = content.toString('utf8');
  if (!source.includes(SW_MISS_ORIGINAL)) {
    console.warn('[cbe] mlsServiceWorker.js: miss-404 block not found — serving UNPATCHED (cold-cache module loads may 404; check upstream SW changes)');
    return content;
  }
  return Buffer.from(source.replace(SW_MISS_ORIGINAL, SW_MISS_PATCHED), 'utf8');
}

/** Logs the resolved locations once at startup so deploys are easy to debug. */
export function logCbeStaticConfig(): void {
  console.info(`[cbe] static dir: ${getStaticDir()} | remote origin: ${getRemoteOrigin()}`);
}

/**
 * Serves a cbe static asset: disk cache -> remote origin (written back to
 * disk). Returns 304 when the client ETag still matches.
 */
export async function getCbeStaticFile(rawUrlPath: string, clientETag: string): Promise<CbeStaticFileResult> {
  const urlPath = rawUrlPath.replace(/\?.*$/u, '');
  if (!isAllowedPath(urlPath) || urlPath.includes('..')) {
    return { statusCode: CBE_HTTP_BAD_REQUEST, msg: `invalid path ${urlPath}` };
  }

  const staticDir = getStaticDir();
  const filePath = normalize(join(staticDir, urlPath));
  if (!filePath.startsWith(staticDir)) {
    return { statusCode: CBE_HTTP_BAD_REQUEST, msg: `invalid path ${urlPath}` };
  }

  let content = readFromDisk(filePath);
  if (!content) {
    console.info(`[cbe] static disk miss ${filePath} -> trying ${getRemoteOrigin()}${urlPath}`);
    content = await fetchFromRemote(urlPath);
    if (content) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content);
      } catch (err) {
        console.error(`[cbe] static disk write error ${filePath}:`, (err as Error).message);
      }
    }
  }

  if (!content) {
    return { statusCode: CBE_HTTP_NOT_FOUND, msg: `file not found ${urlPath}` };
  }

  if (urlPath === '/mlsServiceWorker.js') {
    content = patchServiceWorkerForRuntime(content);
  }

  const eTag = computeETag(content);
  if (clientETag && clientETag.replace(/^W\//u, '').replace(/"/gu, '') === eTag) {
    return { statusCode: CBE_HTTP_NOT_MODIFIED, eTag };
  }

  return {
    statusCode: CBE_HTTP_OK,
    content,
    eTag,
    contentType: getContentTypeByExtension(urlPath),
  };
}
