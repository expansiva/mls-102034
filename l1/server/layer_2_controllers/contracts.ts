/// <mls fileReference="_102034_/l1/server/layer_2_controllers/contracts.ts" enhancement="_blank" />
import type { IDataRuntime } from '/_102034_/l1/server/layer_1_external/data/runtime.js';

export interface BffRequestTelemetryEvent {
  eventType: string;
  label: string;
  durationMs?: number | null;
  metadata?: Record<string, unknown> | null;
  recordedAt: string;
}

export interface BffRequest {
  routine: string;
  params: unknown;
  meta?: {
    requestId?: string;
    userId?: string;
    authToken?: string;
    traceId?: string;
    source?: 'http' | 'message' | 'test';
    telemetry?: BffRequestTelemetryEvent[];
  };
}

export type ShellMode = 'spa' | 'pwa';
export type DeviceKind = 'desktop' | 'mobile';
export type FrontendAsideMode = 'inline' | 'drawer' | 'fullscreen';

export interface FrontendRegionVisibility {
  header: boolean;
  aside: boolean;
  content: boolean;
}

export interface FrontendAppLayout {
  regions: {
    desktop: FrontendRegionVisibility;
    mobile: FrontendRegionVisibility;
  };
  asideMode: {
    desktop: FrontendAsideMode;
    mobile: FrontendAsideMode;
  };
}

export interface FrontendRegionRendererRegistration {
  entrypoint: string;
  tag: string;
}

export type FrontendRouteMatchMode = 'exact' | 'prefix';

export interface FrontendRouteRegistration {
  path: string;
  entrypoint: string;
  tag: string;
  title: string;
  aliases?: string[];
  loadingKey?: string;
  preload?: boolean;
  matchMode?: FrontendRouteMatchMode;
}

export interface FrontendModuleShellPreferences {
  layout?: Partial<FrontendAppLayout>;
}

export interface FrontendNavigationItem {
  id: string;
  label: string;
  href: string;
  description?: string;
}

export interface BffError {
  code: string;
  message: string;
  details?: unknown;
}

export interface BffResponse<TData = unknown> {
  ok: boolean;
  data: TData | null;
  error: BffError | null;
  telemetryReceived?: number;
}

export interface ILogger {
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface IClock {
  nowIso(): string;
}

export interface IIdGenerator {
  newId(): string;
}

export interface RequestContext {
  data: IDataRuntime;
  log: ILogger;
  clock: IClock;
  idGenerator: IIdGenerator;
  requestMeta?: {
    requestId?: string;
    userId?: string;
    traceId?: string;
    source?: 'http' | 'message' | 'test';
  };
}

export interface IRequestEnvelope {
  request: BffRequest;
  ctx: RequestContext;
}

export type BffHandler = (input: IRequestEnvelope) => Promise<BffResponse>;

export interface ModuleBffRegistration {
  projectId: string;
  moduleId: string;
  frontendBasePath: string;
  frontendEntrypoint: string;
  loadRouter: () => Promise<Map<string, BffHandler>>;
}

export interface FrontendAppRegistration {
  projectId: string;
  appId: string;
  basePath: string;
  indexHtmlPath: string;
  assetRoots: string[];
  routePatterns: string[];
  shellMode: ShellMode;
  routes: FrontendRouteRegistration[];
  headerRenderer?: FrontendRegionRendererRegistration;
  asideRenderer?: FrontendRegionRendererRegistration;
  layout: FrontendAppLayout;
  device?: DeviceKind;
  pageTitle?: string;
  navigation?: FrontendNavigationItem[];
  moduleLinks?: FrontendNavigationItem[];
}

export interface RoutineResolution {
  moduleId: string;
  routineName: string;
  registration: ModuleBffRegistration;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  public constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function ok<TData>(data: TData): BffResponse<TData> {
  return {
    ok: true,
    data,
    error: null,
  };
}

export function fail(error: AppError): BffResponse {
  return {
    ok: false,
    data: null,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}
