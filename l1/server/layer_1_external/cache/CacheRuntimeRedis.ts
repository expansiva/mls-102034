/// <mls fileReference="_102034_/l1/server/layer_1_external/cache/CacheRuntimeRedis.ts" enhancement="_blank" />
import { Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { ICacheRuntime } from '/_102034_/l1/server/layer_1_external/cache/CacheRuntimeMemory.js';

interface RedisTarget {
  host: string;
  port: number;
  password?: string;
  db?: number;
  tls: boolean;
}

function parseRedisUrl(url: string): RedisTarget {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`REDIS_URL must be redis:// or rediss:// (got ${parsed.protocol})`);
  }
  const dbPath = parsed.pathname.replace(/^\//u, '');
  const db = dbPath ? Number(dbPath) : undefined;
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: db !== undefined && Number.isFinite(db) ? db : undefined,
    tls: parsed.protocol === 'rediss:',
  };
}

function encodeCommand(args: string[]): Buffer {
  const chunks: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const byteLength = Buffer.byteLength(arg, 'utf8');
    chunks.push(`$${byteLength}\r\n`, arg, '\r\n');
  }
  return Buffer.from(chunks.join(''), 'utf8');
}

function parseBulkOrSimple(buffer: Buffer): { value: string | null; consumed: number } {
  const text = buffer.toString('utf8');
  if (text.length < 2) throw new Error('incomplete redis reply');
  if (text.startsWith('$-1\r\n')) return { value: null, consumed: 5 };
  if (text.startsWith('+') || text.startsWith('-') || text.startsWith(':')) {
    const end = text.indexOf('\r\n');
    if (end < 0) throw new Error('incomplete redis reply');
    const payload = text.slice(1, end);
    if (text.startsWith('-')) throw new Error(payload);
    return { value: payload, consumed: end + 2 };
  }
  if (text.startsWith('$')) {
    const headerEnd = text.indexOf('\r\n');
    if (headerEnd < 0) throw new Error('incomplete redis reply');
    const size = Number(text.slice(1, headerEnd));
    if (!Number.isFinite(size)) throw new Error('invalid redis bulk length');
    const start = headerEnd + 2;
    const end = start + size;
    if (buffer.length < end + 2) throw new Error('incomplete redis reply');
    return { value: buffer.subarray(start, end).toString('utf8'), consumed: end + 2 };
  }
  throw new Error(`unexpected redis reply: ${text.slice(0, 32)}`);
}

export class CacheRuntimeRedis implements ICacheRuntime {
  private socket: Socket | TLSSocket | undefined;
  private connecting: Promise<Socket | TLSSocket> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly target: RedisTarget;

  public constructor(
    url: string,
    private readonly defaultTtlSeconds = 300,
  ) {
    this.target = parseRedisUrl(url);
  }

  public async get<TValue>(key: string): Promise<TValue | null> {
    const raw = await this.command(['GET', key]);
    if (raw === null) return null;
    return JSON.parse(raw) as TValue;
  }

  public async set<TValue>(key: string, value: TValue, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const payload = JSON.stringify(value);
    if (ttl > 0) {
      await this.command(['SET', key, payload, 'EX', String(ttl)]);
      return;
    }
    await this.command(['SET', key, payload]);
  }

  public async del(key: string): Promise<void> {
    await this.command(['DEL', key]);
  }

  public async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    if (!socket) return;
    await new Promise<void>(resolve => {
      socket.end(() => resolve());
    });
  }

  private command(args: string[]): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      const socket = await this.ensureConnected();
      const payload = encodeCommand(args);
      return new Promise<string | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('redis command timed out'));
        }, 2000);
        let buffer = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          try {
            const parsed = parseBulkOrSimple(buffer);
            cleanup();
            resolve(parsed.value);
          } catch (error) {
            if (error instanceof Error && error.message === 'incomplete redis reply') return;
            cleanup();
            reject(error);
          }
        };
        const onError = (error: Error) => {
          cleanup();
          this.socket = undefined;
          this.connecting = undefined;
          reject(error);
        };
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off('data', onData);
          socket.off('error', onError);
        };
        socket.on('data', onData);
        socket.on('error', onError);
        socket.write(payload);
      });
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private ensureConnected(): Promise<Socket | TLSSocket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<Socket | TLSSocket>((resolve, reject) => {
      const socket = this.target.tls
        ? tlsConnect({ host: this.target.host, port: this.target.port })
        : new Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`redis connect timed out (${this.target.host}:${this.target.port})`));
      }, 2000);
      socket.once('error', error => {
        clearTimeout(timeout);
        this.connecting = undefined;
        reject(error);
      });
      const onReady = () => {
        clearTimeout(timeout);
        this.socket = socket;
        resolve(socket);
      };
      if (this.target.tls) {
        socket.once('secureConnect', onReady);
      } else {
        socket.connect(this.target.port, this.target.host, onReady);
      }
    }).then(async socket => {
      if (this.target.password) {
        await this.commandOn(socket, ['AUTH', this.target.password]);
      }
      if (this.target.db !== undefined) {
        await this.commandOn(socket, ['SELECT', String(this.target.db)]);
      }
      return socket;
    });
    return this.connecting;
  }

  private commandOn(socket: Socket | TLSSocket, args: string[]): Promise<string | null> {
    const payload = encodeCommand(args);
    return new Promise<string | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('redis command timed out')), 2000);
      let buffer = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const parsed = parseBulkOrSimple(buffer);
          clearTimeout(timeout);
          socket.off('data', onData);
          resolve(parsed.value);
        } catch (error) {
          if (error instanceof Error && error.message === 'incomplete redis reply') return;
          clearTimeout(timeout);
          socket.off('data', onData);
          reject(error);
        }
      };
      socket.on('data', onData);
      socket.write(payload);
    });
  }
}
