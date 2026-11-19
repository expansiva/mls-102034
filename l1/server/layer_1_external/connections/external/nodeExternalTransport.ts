/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/nodeExternalTransport.ts" enhancement="_blank"/>
import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import type { LookupOptions } from 'node:dns';
import type { IncomingHttpHeaders } from 'node:http';
import type { ExternalTransportCall, ExternalTransportResponse } from '/_102034_/l1/server/layer_1_external/connections/external/sendExternal.js';

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/** Connect only to the address already checked. The name stays on the URL and on the certificate. */
function fixedLookup(address: string) {
  const family = address.includes(':') ? 6 : 4;
  return (_hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function shortFailure(error: NodeJS.ErrnoException): Error {
  const code = error.code ?? '';
  const tls = code.startsWith('ERR_TLS_')
    || code.startsWith('CERT_')
    || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA';
  return new Error(tls ? 'tls' : 'network');
}

function headerMap(incoming: IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (typeof value === 'string') headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(', ');
  }
  return headers;
}

/** One HTTPS call. No redirect. The deadline covers the connection and the body. */
export function nodeExternalTransport(call: ExternalTransportCall): Promise<ExternalTransportResponse> {
  const url = new URL(call.url);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const finish = (error: Error | null, response?: ExternalTransportResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (response) resolve(response);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      request.destroy();
    }, call.timeoutMs);

    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port === '' ? 443 : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: call.method,
      headers: call.headers,
      servername: url.hostname,
      lookup: fixedLookup(call.address),
      // A new connection per call: the shared keep-alive agent keys sockets by name and port, so it could reuse a
      // socket opened to an earlier address instead of the one this call was checked for.
      agent: false,
      timeout: call.timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      let extraBlock = false;
      response.on('data', (chunk: Buffer) => {
        if (extraBlock) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size > call.maxResponseBytes) {
          truncated = true;
          extraBlock = true;
          response.destroy();
          request.destroy();
        }
      });
      const done = (): void => {
        finish(null, {
          status: response.statusCode ?? 0,
          headers: headerMap(response.headers),
          body: Buffer.concat(chunks).toString('utf8'),
          ...(truncated ? { truncated: true } : {}),
        });
      };
      response.on('end', done);
      response.on('close', () => {
        if (truncated || response.complete) done();
      });
      response.on('error', (error: NodeJS.ErrnoException) => {
        if (truncated) done();
        else finish(timedOut ? Object.assign(new Error('timed out'), { name: 'TimeoutError' }) : shortFailure(error));
      });
    });

    request.on('timeout', () => {
      timedOut = true;
      request.destroy();
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (timedOut) finish(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
      else finish(shortFailure(error));
    });
    if (call.body !== undefined) request.write(call.body);
    request.end();
  });
}

/** Every address of the name. The caller chooses and blocks. */
export async function nodeResolveHost(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => record.address);
}
