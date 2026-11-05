/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/listenHost.ts" enhancement="_blank" />

const LISTEN_HOST_ENV = 'COLLAB_LISTEN_HOST';
const DEFAULT_LISTEN_HOST = '0.0.0.0';

/**
 * Address the HTTP server listens on. All interfaces unless COLLAB_LISTEN_HOST names one: the principal needs
 * that for nginx and the lima; a draft child sets 127.0.0.1 because only the principal's proxy talks to it.
 */
export function listenHost(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env[LISTEN_HOST_ENV] ?? '').trim();
  return value === '' ? DEFAULT_LISTEN_HOST : value;
}
