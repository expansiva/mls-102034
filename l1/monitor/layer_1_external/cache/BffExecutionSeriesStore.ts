/// <mls fileReference="_102034_/l1/monitor/layer_1_external/cache/BffExecutionSeriesStore.ts" enhancement="_blank" />
import type { MonitorExecutionEvent, MonitorSeriesPoint } from '/_102034_/l1/monitor/module.js';

type SeriesBucket = {
  timestamp: string;
  total: number;
  success: number;
  clientError: number;
  serverError: number;
  notFound: number;
  byRoutine: Map<string, MonitorSeriesPoint>;
  bySource: Map<string, MonitorSeriesPoint>;
};

function toBucketTimestamp(isoTimestamp: string): string {
  return `${isoTimestamp.slice(0, 19)}Z`;
}

export class BffExecutionSeriesStore {
  private readonly buckets = new Map<string, SeriesBucket>();

  public constructor(private readonly maxWindowSeconds = 100) {}

  public record(event: MonitorExecutionEvent): void {
    const timestamp = toBucketTimestamp(event.finishedAt);
    const bucket = this.buckets.get(timestamp) ?? {
      timestamp,
      total: 0,
      success: 0,
      clientError: 0,
      serverError: 0,
      notFound: 0,
      byRoutine: new Map<string, MonitorSeriesPoint>(),
      bySource: new Map<string, MonitorSeriesPoint>(),
    };

    bucket.total += 1;
    if (event.statusGroup === 'success') {
      bucket.success += 1;
    } else if (event.statusGroup === 'client_error') {
      bucket.clientError += 1;
    } else if (event.statusGroup === 'server_error') {
      bucket.serverError += 1;
    } else if (event.statusGroup === 'not_found') {
      bucket.notFound += 1;
    }

    this.incrementDetailPoint(bucket.byRoutine, event.routine, timestamp, event.statusGroup);
    this.incrementDetailPoint(bucket.bySource, event.source, timestamp, event.statusGroup);
    this.buckets.set(timestamp, bucket);
    this.trim(timestamp);
  }

  public getSeries(input?: {
    windowSeconds?: number;
    routine?: string;
    source?: 'http' | 'message' | 'test';
  }): MonitorSeriesPoint[] {
    const windowSeconds = Math.min(input?.windowSeconds ?? this.maxWindowSeconds, this.maxWindowSeconds);
    const timestamps = this.listRecentTimestamps(windowSeconds);
    return timestamps.map((timestamp) => {
      const bucket = this.buckets.get(timestamp);
      if (!bucket) {
        return {
          timestamp,
          total: 0,
          success: 0,
          clientError: 0,
          serverError: 0,
          notFound: 0,
        };
      }

      if (!input?.routine && !input?.source) {
        return {
          timestamp,
          total: bucket.total,
          success: bucket.success,
          clientError: bucket.clientError,
          serverError: bucket.serverError,
          notFound: bucket.notFound,
        };
      }

      const filteredPoint = input?.routine
        ? bucket.byRoutine.get(input.routine)
        : input?.source
          ? bucket.bySource.get(input.source)
          : undefined;

      return filteredPoint ?? {
        timestamp,
        total: 0,
        success: 0,
        clientError: 0,
        serverError: 0,
        notFound: 0,
      };
    });
  }

  public reset(): void {
    this.buckets.clear();
  }

  private trim(latestTimestamp: string): void {
    const minTimestamp = new Date(Date.parse(latestTimestamp) - ((this.maxWindowSeconds - 1) * 1000));
    for (const timestamp of this.buckets.keys()) {
      if (Date.parse(timestamp) < minTimestamp.getTime()) {
        this.buckets.delete(timestamp);
      }
    }
  }

  private listRecentTimestamps(windowSeconds: number): string[] {
    const now = new Date();
    const timestamps: string[] = [];
    for (let offset = windowSeconds - 1; offset >= 0; offset -= 1) {
      timestamps.push(toBucketTimestamp(new Date(now.getTime() - (offset * 1000)).toISOString()));
    }
    return timestamps;
  }

  private incrementDetailPoint(
    map: Map<string, MonitorSeriesPoint>,
    key: string,
    timestamp: string,
    statusGroup: 'success' | 'client_error' | 'server_error' | 'not_found',
  ): void {
    const point = map.get(key) ?? {
      timestamp,
      total: 0,
      success: 0,
      clientError: 0,
      serverError: 0,
      notFound: 0,
    };

    point.total += 1;
    if (statusGroup === 'success') {
      point.success += 1;
    } else if (statusGroup === 'client_error') {
      point.clientError += 1;
    } else if (statusGroup === 'server_error') {
      point.serverError += 1;
    } else if (statusGroup === 'not_found') {
      point.notFound += 1;
    }

    map.set(key, point);
  }
}

let sharedStore: BffExecutionSeriesStore | null = null;

export function getSharedBffExecutionSeriesStore(): BffExecutionSeriesStore {
  if (!sharedStore) {
    sharedStore = new BffExecutionSeriesStore(100);
  }

  return sharedStore;
}

export function resetSharedBffExecutionSeriesStore(): void {
  sharedStore?.reset();
  sharedStore = null;
}
