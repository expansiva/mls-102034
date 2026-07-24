/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/home.ts" enhancement="_blank" />
import { loadMonitorArchitecture } from '/_102034_/l2/monitor/web/shared/architecture.js';
import { LitElement, html } from 'lit';
import type { MasterFrontendInteractionMode, MasterFrontendNormalizedError } from '/_102029_/l2/contracts/bootstrap.js';
import {
  beginExpectedNavigationLoad,
  bindExpectedNavigationLoad,
  consumeExpectedNavigationLoad,
  runBlockingUiAction,
} from '/_102029_/l2/interactionRuntime.js';
import { loadMonitorDynamodb } from '/_102034_/l2/monitor/web/shared/dynamodb.js';
import {
  formatBytes,
  formatDateTime,
  formatInteger,
  formatMonitorValue,
  formatPercent,
  formatStatusLabel,
  formatTime,
} from '/_102034_/l2/monitor/web/shared/homeFormatters.js';
import { loadMonitorHome } from '/_102034_/l2/monitor/web/shared/home.js';
import { loadMonitorOperationsSummary } from '/_102034_/l2/monitor/web/shared/operations.js';
import { loadMonitorPostgres } from '/_102034_/l2/monitor/web/shared/postgres.js';
import { loadMonitorProcess } from '/_102034_/l2/monitor/web/shared/process.js';
import { loadMonitorSeries } from '/_102034_/l2/monitor/web/shared/series.js';
import { loadMonitorAbend, loadMonitorClientErrors } from '/_102034_/l2/monitor/web/shared/abend.js';
import { loadMonitorTrace } from '/_102034_/l2/monitor/web/shared/trace.js';
import { loadMonitorTestsList, runMonitorTests } from '/_102034_/l2/monitor/web/shared/tests.js';
import { loadMonitorDynamoTableDetails } from '/_102034_/l2/monitor/web/shared/tableDetailsDynamodb.js';
import { loadMonitorPostgresTableDetails } from '/_102034_/l2/monitor/web/shared/tableDetailsPostgres.js';
import { loadMonitorDynamoTableInspect } from '/_102034_/l2/monitor/web/shared/tableInspectDynamodb.js';
import { loadMonitorPostgresTableInspect } from '/_102034_/l2/monitor/web/shared/tableInspectPostgres.js';
import type { MonitorArchitectureResponse } from '/_102034_/l2/monitor/shared/contracts/architecture.js';
import type { MonitorDynamoResponse } from '/_102034_/l2/monitor/shared/contracts/dynamodb.js';
import type {
  MonitorHomeResponse,
  MonitorHomeSeriesPoint,
  MonitorStatisticsSeriesResponse,
} from '/_102034_/l2/monitor/shared/contracts/home.js';
import type {
  MonitorOperationsSummaryResponse,
  MonitorOperationsWindow,
} from '/_102034_/l2/monitor/shared/contracts/operations.js';
import type { MonitorPostgresResponse } from '/_102034_/l2/monitor/shared/contracts/postgres.js';
import type { MonitorProcessResponse } from '/_102034_/l2/monitor/shared/contracts/process.js';
import type { MonitorAbendResponse, MonitorClientErrorsResponse } from '/_102034_/l2/monitor/shared/contracts/abend.js';
import type { MonitorTraceResponse } from '/_102034_/l2/monitor/shared/contracts/trace.js';
import type { MonitorTestsListResponse } from '/_102034_/l2/monitor/shared/contracts/tests.js';
import type { MonitorDynamoTableDetailsResponse } from '/_102034_/l2/monitor/shared/contracts/table-details-dynamodb.js';
import type { MonitorPostgresTableDetailsResponse } from '/_102034_/l2/monitor/shared/contracts/table-details-postgres.js';
import type { MonitorDynamoTableInspectResponse } from '/_102034_/l2/monitor/shared/contracts/table-inspect-dynamodb.js';
import type { MonitorPostgresTableInspectResponse } from '/_102034_/l2/monitor/shared/contracts/table-inspect-postgres.js';

function traceLazy(event: string, details?: Record<string, unknown>) {
  if (!window.isTraceLazy) {
    return;
  }
  console.log('[traceLazy][monitor]', event, details ?? {});
}

type MonitorSection = 'overview' | 'operations' | 'architecture' | 'postgres' | 'dynamodb' | 'process' | 'abend' | 'trace' | 'tests';
type MonitorStorage = 'postgres' | 'dynamodb';
type MonitorRoute =
  | {
      section: 'overview';
      kind: 'section';
    }
  | {
      section: 'operations';
      kind: 'section';
      window?: MonitorOperationsWindow;
      module?: string;
    }
  | {
      section: 'architecture';
      kind: 'section';
    }
  | {
      section: 'postgres';
      kind: 'section';
      databaseName?: string;
    }
  | {
      section: 'dynamodb';
      kind: 'section';
    }
  | {
      section: 'process';
      kind: 'section';
    }
  | {
      section: 'abend';
      kind: 'section';
      module?: string;
    }
  | {
      section: 'trace';
      kind: 'section';
      requestId?: string;
      traceId?: string;
    }
  | {
      section: 'tests';
      kind: 'section';
    }
  | {
      section: 'postgres';
      kind: 'inspect' | 'details';
      tableName: string;
      databaseName?: string;
      page?: number;
      filters: Record<string, string>;
    }
  | {
      section: 'dynamodb';
      kind: 'inspect' | 'details';
      tableName: string;
      cursor?: string;
      cursorStack: string[];
      filters: Record<string, string>;
    };

const OVERVIEW_POLL_MS = 5000;
const OVERVIEW_WINDOW_SECONDS = 100;

function readFilterParams(searchParams: URLSearchParams) {
  return Object.fromEntries(
    [...searchParams.entries()]
      .filter(([key, value]) => key.startsWith('filter.') && value.trim().length > 0)
      .map(([key, value]) => [key.slice('filter.'.length), value]),
  );
}

function parseCursorStack(value: string | null) {
  if (!value) {
    return [];
  }
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function parseMonitorRoute(locationValue: Location): MonitorRoute {
  const pathname = locationValue.pathname;
  const searchParams = new URLSearchParams(locationValue.search);
  const databaseName = searchParams.get('db') ?? undefined;
  const filters = readFilterParams(searchParams);
  const postgresTableMatch = pathname.match(/^\/monitor\/postgres\/tables\/([^/]+)\/(inspect|details)$/);
  if (postgresTableMatch) {
    return {
      section: 'postgres',
      kind: postgresTableMatch[2] as 'inspect' | 'details',
      tableName: decodeURIComponent(postgresTableMatch[1] ?? ''),
      databaseName,
      page: Math.max(1, Number(searchParams.get('page') ?? '1') || 1),
      filters,
    };
  }

  const dynamoTableMatch = pathname.match(/^\/monitor\/dynamodb\/tables\/([^/]+)\/(inspect|details)$/);
  if (dynamoTableMatch) {
    return {
      section: 'dynamodb',
      kind: dynamoTableMatch[2] as 'inspect' | 'details',
      tableName: decodeURIComponent(dynamoTableMatch[1] ?? ''),
      cursor: searchParams.get('cursor') ?? undefined,
      cursorStack: parseCursorStack(searchParams.get('stack')),
      filters,
    };
  }

  if (pathname === '/monitor/postgres') {
    return {
      section: 'postgres',
      kind: 'section',
      databaseName,
    };
  }
  if (pathname === '/monitor/operacao' || pathname === '/monitor/operations') {
    const windowParam = searchParams.get('window');
    const windowValue = windowParam === '1h' || windowParam === '6h' || windowParam === '24h' || windowParam === '7d'
      ? windowParam
      : undefined;
    return {
      section: 'operations',
      kind: 'section',
      window: windowValue,
      module: searchParams.get('module') ?? undefined,
    };
  }
  if (pathname === '/monitor/architecture') {
    return {
      section: 'architecture',
      kind: 'section',
    };
  }
  if (pathname === '/monitor/dynamodb') {
    return {
      section: 'dynamodb',
      kind: 'section',
    };
  }
  if (pathname === '/monitor/process') {
    return {
      section: 'process',
      kind: 'section',
    };
  }
  if (pathname === '/monitor/abend') {
    return {
      section: 'abend',
      kind: 'section',
      module: searchParams.get('module') ?? undefined,
    };
  }
  if (pathname === '/monitor/trace') {
    return {
      section: 'trace',
      kind: 'section',
      requestId: searchParams.get('requestId') ?? undefined,
      traceId: searchParams.get('traceId') ?? undefined,
    };
  }
  if (pathname === '/monitor/tests') {
    return {
      section: 'tests',
      kind: 'section',
    };
  }
  return {
    section: 'overview',
    kind: 'section',
  };
}

function buildMonitorHref(route: MonitorRoute) {
  const searchParams = new URLSearchParams();

  if ('databaseName' in route && route.databaseName) {
    searchParams.set('db', route.databaseName);
  }
  if (route.kind === 'inspect' && route.section === 'postgres' && route.page && route.page > 1) {
    searchParams.set('page', String(route.page));
  }
  if (route.kind === 'inspect' && route.section === 'dynamodb') {
    if (route.cursor) {
      searchParams.set('cursor', route.cursor);
    }
    if (route.cursorStack.length > 0) {
      searchParams.set('stack', route.cursorStack.join(','));
    }
  }
  if (route.kind === 'inspect') {
    Object.entries(route.filters).forEach(([key, value]) => {
      if (value.trim().length > 0) {
        searchParams.set(`filter.${key}`, value);
      }
    });
  }
  if (route.section === 'operations' && route.kind === 'section') {
    if (route.window) {
      searchParams.set('window', route.window);
    }
    if (route.module) {
      searchParams.set('module', route.module);
    }
  }

  const query = searchParams.toString();
  let pathname = '/monitor';
  if (route.section === 'architecture' && route.kind === 'section') {
    pathname = '/monitor/architecture';
  } else if (route.section === 'operations' && route.kind === 'section') {
    pathname = '/monitor/operacao';
  } else if (route.section === 'postgres' && route.kind === 'section') {
    pathname = '/monitor/postgres';
  } else if (route.section === 'dynamodb' && route.kind === 'section') {
    pathname = '/monitor/dynamodb';
  } else if (route.section === 'postgres') {
    pathname = `/monitor/postgres/tables/${encodeURIComponent(route.tableName)}/${route.kind}`;
  } else if (route.section === 'dynamodb') {
    pathname = `/monitor/dynamodb/tables/${encodeURIComponent(route.tableName)}/${route.kind}`;
  } else if (route.section === 'process') {
    pathname = '/monitor/process';
  } else if (route.section === 'abend') {
    pathname = '/monitor/abend';
    if ('module' in route && route.module) {
      searchParams.set('module', route.module);
    }
  } else if (route.section === 'trace') {
    pathname = '/monitor/trace';
    if (route.requestId) {
      searchParams.set('requestId', route.requestId);
    }
    if (route.traceId) {
      searchParams.set('traceId', route.traceId);
    }
  } else if (route.section === 'tests') {
    pathname = '/monitor/tests';
  } else {
    pathname = '/monitor';
  }

  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

function getRouteLabel(route: MonitorRoute) {
  if (route.kind === 'section') {
    return route.section;
  }
  return `${route.section} ${route.kind}`;
}

function getSeriesErrorCount(point: MonitorHomeSeriesPoint) {
  return point.serverError + point.clientError + point.notFound;
}

function buildLinePath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return '';
  }

  const paddingLeft = 18;
  const paddingRight = 18;
  const paddingTop = 12;
  const paddingBottom = 24;
  const usableWidth = width - paddingLeft - paddingRight;
  const usableHeight = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...values, 1);

  return values.map((value, index) => {
    const x = paddingLeft + ((usableWidth * index) / Math.max(values.length - 1, 1));
    const y = paddingTop + usableHeight - ((value / maxValue) * usableHeight);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export class MonitorWebDesktopHomePage extends LitElement {
  static properties = {
    currentSection: { state: true },
    currentRoute: { state: true },
    status: { state: true },
    routeError: { state: true },
    homeData: { state: true },
    operationsData: { state: true },
    copiedOperationsSummary: { state: true },
    homeSeries: { state: true },
    seriesMeta: { state: true },
    architectureData: { state: true },
    postgresData: { state: true },
    dynamodbData: { state: true },
    selectedDatabaseName: { state: true },
    postgresInspectData: { state: true },
    postgresDetailsData: { state: true },
    dynamoInspectData: { state: true },
    dynamoDetailsData: { state: true },
    abendData: { state: true },
    clientErrorsData: { state: true },
    copiedAbendId: { state: true },
    processData: { state: true },
    traceData: { state: true },
    traceSearchInput: { state: true },
    testsData: { state: true },
    testsRunning: { state: true },
  };

  currentSection: MonitorSection = 'overview';
  currentRoute: MonitorRoute = { section: 'overview', kind: 'section' };
  status = 'Preparing monitor module...';
  routeError?: string;
  declare homeData?: MonitorHomeResponse;
  declare operationsData?: MonitorOperationsSummaryResponse;
  declare copiedOperationsSummary?: boolean;
  declare homeSeries?: MonitorHomeSeriesPoint[];
  declare seriesMeta?: MonitorStatisticsSeriesResponse;
  declare architectureData?: MonitorArchitectureResponse;
  declare postgresData?: MonitorPostgresResponse;
  declare dynamodbData?: MonitorDynamoResponse;
  declare selectedDatabaseName?: string;
  declare postgresInspectData?: MonitorPostgresTableInspectResponse;
  declare postgresDetailsData?: MonitorPostgresTableDetailsResponse;
  declare dynamoInspectData?: MonitorDynamoTableInspectResponse;
  declare dynamoDetailsData?: MonitorDynamoTableDetailsResponse;
  declare abendData?: MonitorAbendResponse;
  declare clientErrorsData?: MonitorClientErrorsResponse;
  declare copiedAbendId?: string;
  declare processData?: MonitorProcessResponse;
  declare traceData?: MonitorTraceResponse;
  traceSearchInput = '';
  declare testsData?: MonitorTestsListResponse;
  testsRunning = false;

  private overviewPollTimer: number | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Allow a fixed initial route via the `data-route` attribute so the Studio aura preview
    // (which has no shell/URL) can open a specific section. Falls back to window.location.
    const initialRoute = this.getAttribute('data-route');
    if (initialRoute) {
      try { window.history.replaceState({}, '', initialRoute); } catch { /* preview sandbox */ }
      this.currentRoute = parseMonitorRoute(new URL(initialRoute, 'http://monitor.local') as unknown as Location);
    } else {
      this.currentRoute = parseMonitorRoute(window.location);
    }
    this.currentSection = this.currentRoute.section;
    window.addEventListener('popstate', this.handleLocationChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    void this.loadRouteFromLocation(true);
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.handleLocationChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.stopOverviewPolling();
    super.disconnectedCallback();
  }

  private readonly handleLocationChange = () => {
    const nextRoute = parseMonitorRoute(window.location);
    this.currentRoute = nextRoute;
    this.currentSection = nextRoute.section;
    this.requestUpdate();
    void this.loadRouteFromLocation(false);
  };

  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.stopOverviewPolling();
      return;
    }
    if (this.currentRoute.section === 'overview' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      this.startOverviewPolling();
      void this.refreshOverviewSeries();
    }
  };

  private async loadRouteFromLocation(forceRefresh: boolean) {
    traceLazy('loadRouteFromLocation', {
      pathname: window.location.pathname,
      search: window.location.search,
      forceRefresh,
    });
    const pendingLoad = consumeExpectedNavigationLoad();
    const task = this.loadActiveRoute(forceRefresh, {
      mode: pendingLoad ? 'blocking' : 'silent',
      signal: pendingLoad?.signal,
    });
    bindExpectedNavigationLoad(pendingLoad, task);
    await task.catch(() => undefined);
  }

  private async navigate(route: MonitorRoute, options: {
    replace?: boolean;
    mode?: MasterFrontendInteractionMode;
  } = {}) {
    const href = buildMonitorHref(route);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    const replace = options.replace ?? false;
    const mode = options.mode ?? 'blocking';
    traceLazy('navigate', {
      href,
      replace,
      mode,
    });
    if (href === currentHref && !replace) {
      return;
    }

    if (mode === 'silent') {
      if (replace) {
        window.history.replaceState({}, '', href);
      } else {
        window.history.pushState({}, '', href);
      }
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }

    const retry = () => this.navigate(route, options);
    try {
      await runBlockingUiAction(
        async (signal) => {
          const pendingLoad = beginExpectedNavigationLoad(signal);
          if (replace) {
            window.history.replaceState({}, '', href);
          } else {
            window.history.pushState({}, '', href);
          }
          window.dispatchEvent(new PopStateEvent('popstate'));
          await pendingLoad;
        },
        {
          clearContentWhileBusy: true,
          busyLabel: 'Carregando pagina...',
          errorTitle: 'Nao foi possivel carregar esta pagina',
          retry,
        },
      );
    } catch {
      return;
    }
  }

  private startOverviewPolling() {
    if (this.overviewPollTimer !== null || document.hidden) {
      return;
    }
    this.overviewPollTimer = window.setInterval(() => {
      void this.refreshOverviewSeries();
    }, OVERVIEW_POLL_MS);
  }

  private stopOverviewPolling() {
    if (this.overviewPollTimer !== null) {
      window.clearInterval(this.overviewPollTimer);
      this.overviewPollTimer = null;
    }
  }

  private async refreshOverviewSeries() {
    if (this.currentRoute.section !== 'overview' || this.currentRoute.kind !== 'section') {
      return;
    }

    const response = await loadMonitorSeries(OVERVIEW_WINDOW_SECONDS, {
      mode: 'silent',
    });
    if (!response.ok || !response.data) {
      return;
    }

    this.seriesMeta = response.data;
    this.homeSeries = response.data.series;
    this.status = `Live series updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
  }

  private toBlockingError(message: string, error?: MasterFrontendNormalizedError | null) {
    return (error ?? {
      code: 'UNEXPECTED_ERROR',
      message,
    }) satisfies MasterFrontendNormalizedError;
  }

  private routeErrorMessage(message: string, error?: MasterFrontendNormalizedError | null) {
    return error?.details
      ? `${error.message ?? message} · ${JSON.stringify(error.details)}`
      : (error?.message ?? message);
  }

  private async loadActiveRoute(forceRefresh: boolean, options: {
    mode?: MasterFrontendInteractionMode;
    signal?: AbortSignal;
  } = {}) {
    traceLazy('loadActiveRoute.start', {
      route: buildMonitorHref(this.currentRoute),
      forceRefresh,
      mode: options.mode ?? 'silent',
    });
    if (this.currentRoute.section === 'overview' && this.currentRoute.kind === 'section') {
      this.startOverviewPolling();
      if (!forceRefresh && this.homeData) {
        this.status = `Ready · ${getRouteLabel(this.currentRoute)}`;
        return;
      }

      this.status = 'Loading system overview...';
      const response = await loadMonitorHome({
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load monitor overview.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load monitor overview.';
        return;
      }
      this.homeData = response.data;
      this.homeSeries = response.data.recentSeries;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'overview',
      });
      void this.refreshOverviewSeries();
      return;
    }

    this.stopOverviewPolling();

    if (this.currentRoute.section === 'operations' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      this.status = 'Loading operation summary...';
      const response = await loadMonitorOperationsSummary({
        window: this.currentRoute.window,
        module: this.currentRoute.module,
      }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load operation summary.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load operation summary.';
        return;
      }
      this.operationsData = response.data;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      return;
    }

    if (this.currentRoute.section === 'architecture' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      if (!forceRefresh && this.architectureData) {
        this.status = `Ready · ${getRouteLabel(this.currentRoute)}`;
        return;
      }

      this.status = 'Loading persistence architecture...';
      const response = await loadMonitorArchitecture({
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load architecture.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load architecture.';
        return;
      }
      this.architectureData = response.data;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'architecture',
      });
      return;
    }

    if (this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      if (!forceRefresh && this.postgresData && this.selectedDatabaseName === this.currentRoute.databaseName) {
        this.status = `Ready · ${getRouteLabel(this.currentRoute)}`;
        return;
      }

      this.status = 'Loading Postgres diagnostics...';
      const response = await loadMonitorPostgres(this.currentRoute.databaseName, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load Postgres diagnostics.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load Postgres diagnostics.';
        return;
      }
      this.postgresData = response.data;
      this.selectedDatabaseName = response.data.postgres.connection.currentDatabase;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'postgres',
      });
      if (this.currentRoute.databaseName !== response.data.postgres.connection.currentDatabase) {
        void this.navigate({
          section: 'postgres',
          kind: 'section',
          databaseName: response.data.postgres.connection.currentDatabase,
        }, {
          replace: true,
          mode: 'silent',
        });
      }
      return;
    }

    if (this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      if (!forceRefresh && this.dynamodbData) {
        this.status = `Ready · ${getRouteLabel(this.currentRoute)}`;
        return;
      }

      this.status = 'Loading DynamoDB diagnostics...';
      const response = await loadMonitorDynamodb({
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load DynamoDB diagnostics.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load DynamoDB diagnostics.';
        return;
      }
      this.dynamodbData = response.data;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'dynamodb',
      });
      return;
    }

    if (this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'inspect') {
      this.routeError = undefined;
      this.status = `Inspecting ${this.currentRoute.tableName}...`;
      const response = await loadMonitorPostgresTableInspect({
        databaseName: this.currentRoute.databaseName,
        tableName: this.currentRoute.tableName,
        page: this.currentRoute.page,
        filters: this.currentRoute.filters,
      }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        this.postgresInspectData = undefined;
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not inspect Postgres table.', response.error);
        }
        this.routeError = this.routeErrorMessage('Could not inspect Postgres table.', response.error);
        this.status = response.error?.message ?? 'Could not inspect Postgres table.';
        return;
      }
      this.postgresInspectData = response.data;
      this.routeError = undefined;
      this.selectedDatabaseName = response.data.databaseName;
      this.status = `Inspect updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'postgres.inspect',
      });
      return;
    }

    if (this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'details') {
      this.routeError = undefined;
      this.status = `Loading ${this.currentRoute.tableName} details...`;
      const response = await loadMonitorPostgresTableDetails({
        databaseName: this.currentRoute.databaseName,
        tableName: this.currentRoute.tableName,
      }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        this.postgresDetailsData = undefined;
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load Postgres table details.', response.error);
        }
        this.routeError = this.routeErrorMessage('Could not load Postgres table details.', response.error);
        this.status = response.error?.message ?? 'Could not load Postgres table details.';
        return;
      }
      this.postgresDetailsData = response.data;
      this.routeError = undefined;
      this.selectedDatabaseName = response.data.databaseName;
      this.status = `Details updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'postgres.details',
      });
      return;
    }

    if (this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'inspect') {
      this.routeError = undefined;
      this.status = `Inspecting ${this.currentRoute.tableName}...`;
      const response = await loadMonitorDynamoTableInspect({
        tableName: this.currentRoute.tableName,
        cursor: this.currentRoute.cursor,
        filters: this.currentRoute.filters,
      }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        this.dynamoInspectData = undefined;
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not inspect DynamoDB table.', response.error);
        }
        this.routeError = this.routeErrorMessage('Could not inspect DynamoDB table.', response.error);
        this.status = response.error?.message ?? 'Could not inspect DynamoDB table.';
        return;
      }
      this.dynamoInspectData = response.data;
      this.routeError = undefined;
      this.status = `Inspect updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'dynamodb.inspect',
      });
      return;
    }

    if (this.currentRoute.section === 'process' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      this.status = 'Loading process health...';
      const response = await loadMonitorProcess({
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load process health.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load process health.';
        return;
      }
      this.processData = response.data;
      this.status = `Updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      return;
    }

    if (this.currentRoute.section === 'abend' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      this.status = 'Loading execution errors...';
      const response = await loadMonitorAbend(
        { module: this.currentRoute.module },
        { mode: options.mode, signal: options.signal },
      );
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load abends.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load abends.';
        return;
      }
      this.abendData = response.data;
      this.status = `${response.data.totalCount} failures found · ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      // Frontend errors (client telemetry) — best-effort companion of the abends.
      const clientErrors = await loadMonitorClientErrors(
        { sinceHours: 24 },
        { signal: options.signal },
      );
      this.clientErrorsData = clientErrors.ok ? clientErrors.data ?? undefined : undefined;
      return;
    }

    if (this.currentRoute.section === 'trace' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      const { requestId, traceId } = this.currentRoute;
      if (!requestId && !traceId) {
        this.traceData = undefined;
        this.status = 'Enter a requestId or traceId to search.';
        return;
      }
      this.status = 'Loading trace...';
      const response = await loadMonitorTrace({ requestId, traceId }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load trace.', response.error);
        }
        this.routeError = this.routeErrorMessage('Could not load trace.', response.error);
        this.status = response.error?.message ?? 'Could not load trace.';
        return;
      }
      this.traceData = response.data;
      this.status = `${response.data.totalCount} entries found`;
      return;
    }

    if (this.currentRoute.section === 'tests' && this.currentRoute.kind === 'section') {
      this.routeError = undefined;
      this.status = 'Loading generated BFF tests...';
      const response = await loadMonitorTestsList({ mode: options.mode, signal: options.signal });
      if (!response.ok || !response.data) {
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load tests.', response.error);
        }
        this.status = response.error?.message ?? 'Could not load tests.';
        return;
      }
      this.testsData = response.data;
      const pageCount = response.data.modules.reduce((sum, module) => sum + module.pages.length, 0);
      this.status = response.data.executionEnabled
        ? `${pageCount} page(s) with tests · execution enabled (${response.data.appEnv})`
        : `${pageCount} page(s) with tests · execution disabled outside development (${response.data.appEnv})`;
      return;
    }

    if (this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'details') {
      this.routeError = undefined;
      this.status = `Loading ${this.currentRoute.tableName} details...`;
      const response = await loadMonitorDynamoTableDetails({
        tableName: this.currentRoute.tableName,
      }, {
        mode: options.mode,
        signal: options.signal,
      });
      if (!response.ok || !response.data) {
        this.dynamoDetailsData = undefined;
        if (options.mode === 'blocking') {
          throw this.toBlockingError('Could not load DynamoDB table details.', response.error);
        }
        this.routeError = this.routeErrorMessage('Could not load DynamoDB table details.', response.error);
        this.status = response.error?.message ?? 'Could not load DynamoDB table details.';
        return;
      }
      this.dynamoDetailsData = response.data;
      this.routeError = undefined;
      this.status = `Details updated ${new Date(response.data.generatedAt).toLocaleTimeString('pt-BR')}`;
      traceLazy('loadActiveRoute.success', {
        route: 'dynamodb.details',
      });
    }
  }

  private renderRouteError() {
    if (!this.routeError) {
      return null;
    }

    return html`
      <article class="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900 shadow-sm">
        <div class="font-semibold">Monitor request failed</div>
        <div class="mt-2 break-words">${this.routeError}</div>
      </article>
    `;
  }

  private async refreshCurrentSection() {
    try {
      await runBlockingUiAction(
        (signal) => this.loadActiveRoute(true, {
          mode: 'blocking',
          signal,
        }),
        {
          busyLabel: 'Atualizando dados...',
          errorTitle: 'Nao foi possivel atualizar esta pagina',
          retry: () => this.loadActiveRoute(true, {
            mode: 'blocking',
          }),
        },
      );
    } catch {
      return;
    }
  }

  private handleNavClick(event: Event, route: MonitorRoute) {
    event.preventDefault();
    void this.navigate(route);
  }

  private handleDatabaseChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    this.selectedDatabaseName = target?.value || undefined;
    void this.navigate({
      section: 'postgres',
      kind: 'section',
      databaseName: this.selectedDatabaseName,
    });
  }

  private handlePostgresInspectFilters(event: Event) {
    event.preventDefault();
    if (this.currentRoute.section !== 'postgres' || this.currentRoute.kind !== 'inspect') {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const filters = Object.fromEntries(
      [...formData.entries()]
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
        .map(([key, value]) => [key, String(value)]),
    );
    void this.navigate({
      ...this.currentRoute,
      page: 1,
      filters,
    });
  }

  private handleDynamoInspectFilters(event: Event) {
    event.preventDefault();
    if (this.currentRoute.section !== 'dynamodb' || this.currentRoute.kind !== 'inspect') {
      return;
    }
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const filters = Object.fromEntries(
      [...formData.entries()]
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
        .map(([key, value]) => [key, String(value)]),
    );
    void this.navigate({
      ...this.currentRoute,
      cursor: undefined,
      cursorStack: [],
      filters,
    });
  }

  private renderBreadcrumb(route: MonitorRoute) {
    const sectionRoute = route.section === 'postgres'
      ? { section: 'postgres', kind: 'section', databaseName: 'databaseName' in route ? route.databaseName : this.selectedDatabaseName } as const
      : route.section === 'dynamodb'
        ? { section: 'dynamodb', kind: 'section' } as const
        : route.section === 'operations'
          ? { section: 'operations', kind: 'section', window: 'window' in route ? route.window : undefined, module: 'module' in route ? route.module : undefined } as const
          : route.section === 'process'
            ? { section: 'process', kind: 'section' } as const
            : route.section === 'abend'
              ? { section: 'abend', kind: 'section', module: 'module' in route ? route.module : undefined } as const
              : route.section === 'trace'
                ? { section: 'trace', kind: 'section', requestId: 'requestId' in route ? route.requestId : undefined, traceId: 'traceId' in route ? route.traceId : undefined } as const
                : { section: 'architecture', kind: 'section' } as const;

    return html`
      <div class="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <a class="rounded-full bg-slate-100 px-3 py-1 hover:bg-slate-200" href="/monitor" @click=${(event: Event) => this.handleNavClick(event, { section: 'overview', kind: 'section' })}>Overview</a>
        ${route.section !== 'overview'
          ? html`
              <span>/</span>
              <a
                class="rounded-full bg-slate-100 px-3 py-1 hover:bg-slate-200"
                href="${buildMonitorHref(sectionRoute)}"
                @click=${(event: Event) => this.handleNavClick(event, sectionRoute)}
              >
                ${route.section}
              </a>
            `
          : null}
        ${route.kind !== 'section'
          ? html`
              <span>/</span>
              <span class="rounded-full bg-aura-blue px-3 py-1 text-white">${route.tableName}</span>
              <span>/</span>
              <span>${route.kind}</span>
            `
          : null}
      </div>
    `;
  }

  private renderStorageProfile(profile?: string | null) {
    switch (profile) {
      case 'postgresHotBackup':
        return 'Postgres + hot backup';
      case 'dynamoOnly':
        return 'DynamoDB only';
      case 'dynamoWithPostgresIndex':
        return 'DynamoDB + local index';
      case 'postgres':
      default:
        return 'Postgres';
    }
  }

  private renderOverviewChart(series: MonitorHomeSeriesPoint[]) {
    const valuesTotal = series.map((point) => point.total);
    const valuesSuccess = series.map((point) => point.success);
    const valuesErrors = series.map((point) => getSeriesErrorCount(point));
    const maxValue = Math.max(
      ...valuesTotal,
      ...valuesSuccess,
      ...valuesErrors,
      1,
    );
    const totalPath = buildLinePath(valuesTotal, 900, 240);
    const successPath = buildLinePath(valuesSuccess, 900, 240);
    const errorPath = buildLinePath(valuesErrors, 900, 240);

    return html`
      <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">Recent execution series</h2>
            <p class="mt-1 text-sm text-slate-500">Live window of ${formatInteger(series.length)} points with background refresh every 5 seconds.</p>
          </div>
          <div class="flex flex-wrap gap-3 text-xs text-slate-500">
            <span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-slate-900"></span>Total</span>
            <span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>Success</span>
            <span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-rose-500"></span>Errors</span>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-100 bg-slate-50 p-4">
          <svg viewBox="0 0 900 240" class="h-64 w-full" preserveAspectRatio="none" aria-label="Recent execution series">
            <line x1="18" y1="216" x2="882" y2="216" stroke="#cbd5e1" stroke-width="1"></line>
            <line x1="18" y1="12" x2="18" y2="216" stroke="#cbd5e1" stroke-width="1"></line>
            <path d="${totalPath}" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round"></path>
            <path d="${successPath}" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round"></path>
            <path d="${errorPath}" fill="none" stroke="#f43f5e" stroke-width="3" stroke-linecap="round"></path>
          </svg>
          <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>${formatTime(series[0]?.timestamp)}</span>
            <span>peak ${formatInteger(maxValue)}</span>
            <span>${formatTime(series.at(-1)?.timestamp)}</span>
          </div>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div class="text-xs uppercase tracking-wide text-slate-500">Latest total</div>
            <div class="mt-2 text-2xl font-semibold text-slate-900">${formatInteger(series.at(-1)?.total)}</div>
          </div>
          <div class="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <div class="text-xs uppercase tracking-wide text-emerald-700">Latest success</div>
            <div class="mt-2 text-2xl font-semibold text-emerald-900">${formatInteger(series.at(-1)?.success)}</div>
          </div>
          <div class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
            <div class="text-xs uppercase tracking-wide text-rose-700">Latest errors</div>
            <div class="mt-2 text-2xl font-semibold text-rose-900">${formatInteger(getSeriesErrorCount(series.at(-1) ?? {
              timestamp: '',
              total: 0,
              success: 0,
              clientError: 0,
              serverError: 0,
              notFound: 0,
            }))}</div>
          </div>
        </div>
      </article>
    `;
  }

  private severityClass(severity: MonitorOperationsSummaryResponse['severity']) {
    if (severity === 'red') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (severity === 'yellow') return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  }

  private async copyOperationsSummary() {
    if (!this.operationsData) return;
    try {
      await navigator.clipboard.writeText(this.operationsData.copyText);
      this.copiedOperationsSummary = true;
      window.setTimeout(() => {
        this.copiedOperationsSummary = false;
      }, 2000);
    } catch (err) {
      console.error('[monitor] clipboard copy failed:', err);
    }
  }

  private handleOperationsFilters(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const windowValue = String(formData.get('window') ?? '24h') as MonitorOperationsWindow;
    const moduleValue = String(formData.get('module') ?? '').trim();
    void this.navigate({
      section: 'operations',
      kind: 'section',
      window: windowValue,
      module: moduleValue.length > 0 ? moduleValue : undefined,
    });
  }

  private renderOperations() {
    const data = this.operationsData;
    if (!data) {
      return html`
        <section class="space-y-6">
          ${this.renderRouteError()}
          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p class="text-sm text-slate-500">Loading operation summary...</p>
          </article>
        </section>
      `;
    }

    const cards = [
      { label: 'Executions', value: formatInteger(data.executions.total), hint: `${data.executions.okPercent}% ok` },
      { label: 'Server errors', value: formatInteger(data.executions.serverError), hint: `${data.executions.change.serverError >= 0 ? '+' : ''}${formatInteger(data.executions.change.serverError)} vs previous` },
      { label: 'Abends', value: formatInteger(data.abends.total), hint: `${formatInteger(data.abends.groups.length)} grouped routine(s)` },
      { label: 'p95 duration', value: `${formatInteger(data.executions.p95DurationMs)} ms`, hint: `${data.executions.change.p95DurationMs >= 0 ? '+' : ''}${formatInteger(data.executions.change.p95DurationMs)} ms vs previous` },
    ];

    return html`
      <section class="space-y-6">
        ${this.renderRouteError()}
        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="flex flex-wrap items-center gap-3">
                <h1 class="text-2xl font-semibold text-slate-950">Operation</h1>
                <span class="rounded-full border px-3 py-1 text-sm font-semibold ${this.severityClass(data.severity)}">${data.severity.toUpperCase()} · ${data.health.score}</span>
              </div>
              <p class="mt-2 text-sm text-slate-500">
                ${data.window.label} window · ${formatDateTime(data.window.startedAt)} to ${formatDateTime(data.window.finishedAt)}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <form class="flex flex-wrap items-center gap-2" @submit=${(event: Event) => this.handleOperationsFilters(event)}>
                <select name="window" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                  ${(['1h', '6h', '24h', '7d'] as MonitorOperationsWindow[]).map((entry) => html`
                    <option value=${entry} ?selected=${data.window.label === entry}>${entry}</option>
                  `)}
                </select>
                <input
                  name="module"
                  class="w-36 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="module"
                  .value=${data.filters.module ?? ''}
                />
                <button class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700" type="submit">Verify</button>
              </form>
              <button
                class="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                @click=${() => void this.copyOperationsSummary()}
              >${this.copiedOperationsSummary ? 'Copied' : 'Copy'}</button>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap gap-2">
            ${data.health.reasons.map((reason) => html`
              <span class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">${reason}</span>
            `)}
          </div>
        </article>

        <div class="grid gap-4 md:grid-cols-4">
          ${cards.map((card) => html`
            <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div class="text-sm text-slate-500">${card.label}</div>
              <div class="mt-2 text-2xl font-semibold text-slate-950">${card.value}</div>
              <div class="mt-1 text-xs text-slate-500">${card.hint}</div>
            </article>
          `)}
        </div>

        <div class="grid gap-6 xl:grid-cols-2">
          <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div class="border-b border-slate-200 px-6 py-4">
              <h2 class="text-lg font-semibold text-slate-900">Grouped abends</h2>
              <p class="mt-1 text-sm text-slate-500">Repeated failures are grouped by routine.</p>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead class="bg-slate-50 text-slate-600">
                  <tr>
                    <th class="px-6 py-3 font-medium">Routine</th>
                    <th class="px-6 py-3 font-medium">Count</th>
                    <th class="px-6 py-3 font-medium">Last</th>
                    <th class="px-6 py-3 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.abends.groups.length > 0
                    ? data.abends.groups.map((entry) => html`
                        <tr class="border-t border-slate-100 align-top">
                          <td class="px-6 py-4">
                            <div class="font-medium text-slate-900">${entry.routine}</div>
                            <div class="text-xs text-slate-500">${entry.module}</div>
                          </td>
                          <td class="px-6 py-4">${formatInteger(entry.count)}</td>
                          <td class="px-6 py-4">${formatDateTime(entry.lastAt)}</td>
                          <td class="px-6 py-4">
                            <div>${entry.latest.errorCode ?? `HTTP ${entry.latest.statusCode}`}</div>
                            ${entry.latest.errorStack
                              ? html`<details class="mt-1"><summary class="cursor-pointer text-xs text-slate-500">stack</summary><pre class="mt-2 max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">${entry.latest.errorStack}</pre></details>`
                              : null}
                          </td>
                        </tr>
                      `)
                    : html`<tr><td class="px-6 py-8 text-center text-slate-500" colspan="4">No abends in this window.</td></tr>`}
                </tbody>
              </table>
            </div>
          </article>

          <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div class="border-b border-slate-200 px-6 py-4">
              <h2 class="text-lg font-semibold text-slate-900">Frontend errors</h2>
              <p class="mt-1 text-sm text-slate-500">Browser errors captured by runtime telemetry.</p>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead class="bg-slate-50 text-slate-600">
                  <tr>
                    <th class="px-6 py-3 font-medium">Routine</th>
                    <th class="px-6 py-3 font-medium">Type</th>
                    <th class="px-6 py-3 font-medium">Count</th>
                    <th class="px-6 py-3 font-medium">Last</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.frontendErrors.groups.length > 0
                    ? data.frontendErrors.groups.map((entry) => html`
                        <tr class="border-t border-slate-100 align-top">
                          <td class="px-6 py-4">
                            <div class="font-medium text-slate-900">${entry.routine}</div>
                            <div class="text-xs text-slate-500">${entry.latestLabel ?? ''}</div>
                          </td>
                          <td class="px-6 py-4">${entry.eventType}</td>
                          <td class="px-6 py-4">${formatInteger(entry.count)}</td>
                          <td class="px-6 py-4">${formatDateTime(entry.lastAt)}</td>
                        </tr>
                      `)
                    : html`<tr><td class="px-6 py-8 text-center text-slate-500" colspan="4">No frontend errors in this window.</td></tr>`}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div class="grid gap-6 xl:grid-cols-2">
          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Slowest routines</h2>
            <div class="mt-4 space-y-3">
              ${data.executions.slowestRoutines.length > 0
                ? data.executions.slowestRoutines.map((entry) => html`
                    <div class="rounded-2xl border border-slate-100 p-4">
                      <div class="flex items-center justify-between gap-4">
                        <div class="font-medium text-slate-900">${entry.routine}</div>
                        <div class="text-sm text-slate-600">p95 ${formatInteger(entry.p95DurationMs)} ms</div>
                      </div>
                      <div class="mt-1 text-xs text-slate-500">${entry.module} · avg ${formatInteger(entry.avgDurationMs)} ms · ${formatInteger(entry.total)} call(s)</div>
                    </div>
                  `)
                : html`<p class="text-sm text-slate-500">No execution data in this window.</p>`}
            </div>
          </article>

          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Infra</h2>
            <div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div class="rounded-2xl bg-slate-50 p-4">
                <div class="text-slate-500">Process</div>
                <div class="mt-1 font-medium text-slate-900">RSS ${data.infra.process.rssMb} MB · heap ${data.infra.process.heapUsedMb} MB</div>
                <div class="mt-1 text-xs text-slate-500">${data.infra.process.nodeVersion} · pid ${data.infra.process.pid}</div>
              </div>
              <div class="rounded-2xl bg-slate-50 p-4">
                <div class="text-slate-500">Postgres</div>
                <div class="mt-1 font-medium text-slate-900">${formatInteger(data.infra.postgres.activeConnections)} connection(s)</div>
                <div class="mt-1 text-xs text-slate-500">${data.infra.postgres.currentDatabase} · locks ${formatInteger(data.infra.postgres.waitingLocks)}</div>
              </div>
              ${data.infra.disks.map((disk) => html`
                <div class="rounded-2xl bg-slate-50 p-4">
                  <div class="text-slate-500">Disk ${disk.path}</div>
                  <div class="mt-1 font-medium text-slate-900">${disk.exists ? `${disk.usedPercent}% used` : 'not found'}</div>
                  <div class="mt-1 text-xs text-slate-500">${disk.exists ? `${formatBytes(disk.freeBytes ?? 0)} free of ${formatBytes(disk.sizeBytes ?? 0)}` : ''}</div>
                </div>
              `)}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  private renderOverview() {
    const data = this.homeData;
    const overview = data?.bff.overview;
    const byRoutine = data?.bff.byRoutine ?? [];
    const recentFailures = data?.bff.recentFailures ?? [];
    const series = this.homeSeries ?? data?.recentSeries ?? [];

    return html`
      <section class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Total calls', formatInteger(overview?.totalExecutions), 'All BFF executions recorded')}
          ${this.renderMetricCard('Success', formatInteger(overview?.successCount), 'Healthy routine calls')}
          ${this.renderMetricCard('Server errors', formatInteger(overview?.serverErrorCount), '5xx responses observed')}
          ${this.renderMetricCard('Not found', formatInteger(overview?.notFoundCount), '404 routine responses')}
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          ${this.renderMetricCard('Postgres tables', formatInteger(data?.postgres.tableCount), `${formatInteger(data?.postgres.missingTableCount)} missing in ${data?.postgres.currentDatabase ?? 'db'}`)}
          ${this.renderMetricCard('Cache hit rate', formatPercent(data?.postgres.cacheHitRate), `Active connections ${formatInteger(data?.postgres.activeConnections)}`)}
          ${this.renderMetricCard('Dynamo tables', formatInteger(data?.dynamodb.availableTables), `${formatInteger(data?.dynamodb.missingTables)} missing`)}
        </div>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold text-slate-900">Postgres runtime target</h2>
            <span class="text-sm text-slate-500">${data?.postgres.host ?? 'host'}:${data?.postgres.port ?? 0}</span>
          </div>
          <div class="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Current database</div>
              <div class="mt-2 text-2xl font-semibold text-slate-950">${data?.postgres.currentDatabase ?? 'n/a'}</div>
            </div>
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Available databases</div>
              <div class="mt-3 flex flex-wrap gap-2">
                ${(data?.postgres.availableDatabases ?? []).map((databaseName) => html`
                  <span class="${databaseName === data?.postgres.currentDatabase ? 'rounded-full bg-aura-blue px-3 py-1 text-sm font-medium text-white' : 'rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700'}">
                    ${databaseName}
                  </span>
                `)}
              </div>
            </div>
          </div>
        </article>

        <div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Routine activity</h2>
              <span class="text-sm text-slate-500">${data?.system.appEnv ?? 'env'} · ${data?.system.runtimeMode ?? 'mode'}</span>
            </div>
            <div class="space-y-3">
              ${byRoutine.map((item) => html`
                <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <strong class="text-sm text-slate-900">${item.routine}</strong>
                    <span class="text-sm font-medium text-slate-700">${formatInteger(item.totalCount)}</span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                    <span>avg ${formatInteger(item.avgDurationMs)} ms</span>
                    <span>last ${formatDateTime(item.lastFinishedAt)}</span>
                  </div>
                </div>
              `)}
            </div>
          </article>

          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="mb-4 text-lg font-semibold text-slate-900">Recent failures</h2>
            <div class="space-y-3">
              ${recentFailures.length > 0
                ? recentFailures.map((item) => html`
                    <div class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                      <strong class="block text-sm text-rose-950">${item.routine}</strong>
                      <div class="mt-1 text-xs text-rose-700">
                        ${item.statusCode} · ${formatStatusLabel(item.statusGroup)} · ${item.errorCode ?? 'no error code'}
                      </div>
                      <div class="mt-2 text-xs text-rose-600">${formatDateTime(item.finishedAt)}</div>
                    </div>
                  `)
                : html`<div class="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No recent failures recorded.</div>`}
            </div>
          </article>
        </div>

        ${this.renderOverviewChart(series)}
      </section>
    `;
  }

  private renderPostgresTableLinks(table: MonitorPostgresResponse['postgres']['tables'][number]) {
    const baseRoute = {
      section: 'postgres' as const,
      tableName: table.tableName,
      databaseName: this.selectedDatabaseName,
    };
    return html`
      <div class="font-medium text-slate-900">${table.tableName}</div>
      <div class="mt-1 text-xs text-slate-500">${table.description ?? 'No description registered.'}</div>
      <div class="mt-2 flex gap-2 text-xs">
        <a
          class="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200"
          href="${buildMonitorHref({ ...baseRoute, kind: 'inspect', page: 1, filters: {} })}"
          @click=${(event: Event) => this.handleNavClick(event, { ...baseRoute, kind: 'inspect', page: 1, filters: {} })}
        >
          inspect
        </a>
        <a
          class="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200"
          href="${buildMonitorHref({ ...baseRoute, kind: 'details', filters: {} })}"
          @click=${(event: Event) => this.handleNavClick(event, { ...baseRoute, kind: 'details', filters: {} })}
        >
          details
        </a>
      </div>
    `;
  }

  private renderDynamoTableLinks(table: MonitorDynamoResponse['dynamodb']['tables'][number]) {
    const inspectRoute: MonitorRoute = {
      section: 'dynamodb',
      kind: 'inspect',
      tableName: table.tableName,
      cursor: undefined,
      cursorStack: [],
      filters: {},
    };
    const detailsRoute: MonitorRoute = {
      section: 'dynamodb',
      kind: 'details',
      tableName: table.tableName,
      cursorStack: [],
      filters: {},
    };
    return html`
      <div class="font-medium text-slate-900">${table.tableName}</div>
      <div class="mt-1 text-xs text-slate-500">${table.description ?? 'No description registered.'}</div>
      <div class="mt-2 flex gap-2 text-xs">
        <a class="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200" href="${buildMonitorHref(inspectRoute)}" @click=${(event: Event) => this.handleNavClick(event, inspectRoute)}>inspect</a>
        <a class="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200" href="${buildMonitorHref(detailsRoute)}" @click=${(event: Event) => this.handleNavClick(event, detailsRoute)}>details</a>
      </div>
    `;
  }

  private renderArchitecture() {
    const data = this.architectureData?.architecture;
    const tables = data?.tables ?? [];

    return html`
      <section class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Tables', formatInteger(data?.totalTables), 'Registered in schema registry')}
          ${this.renderMetricCard('Postgres backed', formatInteger(data?.postgresBackedTables), 'Operational or indexed locally')}
          ${this.renderMetricCard('Dynamo backed', formatInteger(data?.dynamoBackedTables), 'Physical Dynamo tables expected')}
          ${this.renderMetricCard('Hot backup', formatInteger(data?.hotBackupTables), 'Explicit backupHot = true')}
        </div>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Persistence architecture</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Table</th>
                  <th class="px-6 py-3 font-medium">Architecture</th>
                  <th class="px-6 py-3 font-medium">Backup</th>
                  <th class="px-6 py-3 font-medium">Local indexes</th>
                  <th class="px-6 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                ${tables.map((table) => html`
                  <tr class="border-t border-slate-100 align-top">
                    <td class="px-6 py-4">
                      <div class="font-medium text-slate-900">${table.tableName}</div>
                      <div class="mt-1 text-xs text-slate-500">${table.description || 'No description registered.'}</div>
                      <div class="mt-2 text-xs text-slate-400">${table.moduleId} · ${table.repositoryName}</div>
                    </td>
                    <td class="px-6 py-4 text-slate-700">
                      <div>${this.renderStorageProfile(table.storageProfile)}</div>
                      <div class="mt-1 text-xs text-slate-500">${table.purpose} · ${table.writeMode}</div>
                    </td>
                    <td class="px-6 py-4">
                      <span class="${table.backupHot ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800' : 'rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700'}">
                        ${table.backupHot ? 'hot backup' : 'no backup'}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-slate-700">
                      ${table.localIndexes.length > 0
                        ? table.localIndexes.map((index) => html`
                            <div class="mb-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                              <div class="text-xs font-medium text-slate-800">${index.name}</div>
                              <div class="mt-1 text-xs text-slate-500">${index.columns.join(', ') || 'expression index'}${index.unique ? ' · unique' : ''}</div>
                            </div>
                          `)
                        : html`<span class="text-slate-400">none</span>`}
                    </td>
                    <td class="px-6 py-4 text-slate-700">
                      <div>${table.dynamoTableName ? `Dynamo: ${table.dynamoTableName}` : 'No Dynamo table'}</div>
                      <div class="mt-1 text-xs text-slate-500">
                        ${table.detailsInDynamoOnly
                          ? 'Dados detalhados ficam somente no DynamoDB.'
                          : 'Dados detalhados tambem ficam no Postgres.'}
                      </div>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderPostgres() {
    const data = this.postgresData?.postgres;
    const tables = data?.tables ?? [];
    const runtimeDatabase = data?.connection.runtimeDatabase;
    const inspectingRuntimeDatabase = !runtimeDatabase || data?.connection.currentDatabase === runtimeDatabase;

    return html`
      <section class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Active connections', formatInteger(data?.database.activeConnections), `DB ${data?.database.name ?? 'postgres'}`)}
          ${this.renderMetricCard('Waiting locks', formatInteger(data?.database.waitingLocks), 'Pending lock grants')}
          ${this.renderMetricCard('Cache hit rate', formatPercent(data?.database.cacheHitRate), `Deadlocks ${formatInteger(data?.database.deadlockCount)}`)}
          ${this.renderMetricCard('Pending outbox', formatInteger(data?.queue.pendingOutbox), `Failures ${formatInteger(data?.queue.replicationFailures)}`)}
        </div>

        <div class="grid gap-4 xl:grid-cols-3">
          ${this.renderMetricCard('Cache entries', formatInteger(data?.queue.cacheEntries), 'Rows in the local mdm documents table')}
          ${this.renderMetricCard('Processed outbox', formatInteger(data?.queue.processedOutbox), 'Historical completed queue items')}
          ${this.renderMetricCard('Transactions', formatInteger((data?.database.commitCount ?? 0) + (data?.database.rollbackCount ?? 0)), `Rollback ${formatInteger(data?.database.rollbackCount)}`)}
        </div>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Connection scope</h2>
              <div class="mt-1 text-sm text-slate-500">${data?.connection.host ?? 'host'}:${data?.connection.port ?? 0}</div>
            </div>
            <label class="flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
              <span>Inspect database</span>
              <select class="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" @change=${(event: Event) => this.handleDatabaseChange(event)}>
                ${(data?.connection.availableDatabases ?? []).map((databaseName) => html`
                  <option value="${databaseName}" ?selected=${databaseName === this.selectedDatabaseName}>
                    ${databaseName}${databaseName === runtimeDatabase ? ' (runtime)' : ''}
                  </option>
                `)}
              </select>
            </label>
          </div>
          ${inspectingRuntimeDatabase
            ? null
            : html`
                <div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  You are inspecting <strong>${data?.connection.currentDatabase}</strong>, but the runtime database configured for this app is
                  <strong>${runtimeDatabase}</strong>. Missing tables here do not mean the publish migration failed.
                </div>
              `}
          <div class="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Inspecting database</div>
              <div class="mt-2 text-2xl font-semibold text-slate-950">${data?.connection.currentDatabase ?? 'n/a'}</div>
              <div class="mt-1 text-xs text-slate-500">Runtime database: ${runtimeDatabase ?? 'n/a'}</div>
            </div>
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Available databases</div>
              <div class="mt-3 flex flex-wrap gap-2">
                ${(data?.connection.availableDatabases ?? []).map((databaseName) => html`
                  <span class="${databaseName === data?.connection.currentDatabase ? 'rounded-full bg-aura-blue px-3 py-1 text-sm font-medium text-white' : 'rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700'}">
                    ${databaseName}${databaseName === runtimeDatabase ? ' · runtime' : ''}
                  </span>
                `)}
              </div>
            </div>
          </div>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Known Postgres tables</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Table</th>
                  <th class="px-6 py-3 font-medium">Status</th>
                  <th class="px-6 py-3 font-medium">Rows</th>
                  <th class="px-6 py-3 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                ${tables.map((table) => html`
                  <tr class="border-t border-slate-100 align-top">
                    <td class="px-6 py-4">${this.renderPostgresTableLinks(table)}</td>
                    <td class="px-6 py-4">
                      <span class="${table.exists ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800' : 'rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800'}">
                        ${table.exists ? 'available' : 'missing'}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-slate-700">${table.exists ? formatInteger(table.rowCount) : 'n/a'}</td>
                    <td class="px-6 py-4 text-slate-700">${table.exists ? formatBytes(table.totalSizeBytes) : 'n/a'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderDynamodb() {
    const data = this.dynamodbData?.dynamodb;
    const tables = data?.tables ?? [];

    return html`
      <section class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Region', data?.region ?? 'n/a', 'AWS region configured for runtime')}
          ${this.renderMetricCard('Available tables', formatInteger(data?.summary.availableTables), `Missing ${formatInteger(data?.summary.missingTables)}`)}
          ${this.renderMetricCard('Total items', formatInteger(data?.summary.totalItemCount), 'Approximate metadata from DescribeTable')}
          ${this.renderMetricCard('Runtime mode', data?.runtimeMode ?? 'memory', 'Dynamo inspection is runtime-aware')}
        </div>

        <article class="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
          <div class="font-semibold">Dynamo metrics are approximate</div>
          <div class="mt-2">Rows and bytes come from DescribeTable metadata and can stay stale for hours even when the items are already visible in inspect.</div>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Known DynamoDB tables</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Table</th>
                  <th class="px-6 py-3 font-medium">Status</th>
                  <th class="px-6 py-3 font-medium">Items</th>
                  <th class="px-6 py-3 font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                ${tables.map((table) => html`
                  <tr class="border-t border-slate-100 align-top">
                    <td class="px-6 py-4">${this.renderDynamoTableLinks(table)}</td>
                    <td class="px-6 py-4">
                      <span class="${table.exists ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800' : 'rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800'}">
                        ${table.tableStatus ?? (table.exists ? 'available' : 'missing')}
                      </span>
                    </td>
                    <td class="px-6 py-4 text-slate-700">${table.exists ? `~${formatInteger(table.itemCount)}` : 'n/a'}</td>
                    <td class="px-6 py-4 text-slate-700">${table.exists ? `~${formatBytes(table.tableSizeBytes)}` : 'n/a'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderPostgresInspect() {
    const data = this.postgresInspectData;
    const route = this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'inspect' ? this.currentRoute : null;
    const canGoBack = (data?.pagination.page ?? 1) > 1;
    const canGoNext = (data?.pagination.page ?? 1) < (data?.pagination.totalPages ?? 0);

    return html`
      <section class="space-y-6">
        ${route ? this.renderBreadcrumb(route) : null}
        ${this.renderRouteError()}
        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Inspect ${data?.tableName ?? 'table'}</h2>
              <p class="mt-1 text-sm text-slate-500">${data?.databaseName ?? 'database'} · ${formatInteger(data?.pagination.totalRows)} rows</p>
              <p class="mt-1 text-sm text-slate-500">${data?.description ?? 'No description registered.'}</p>
            </div>
            <div class="text-sm text-slate-500">
              ordered by ${(data?.order.primary.length ?? 0) > 0 ? data?.order.primary.join(', ') : data?.order.fallback ?? 'n/a'}
            </div>
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 class="text-base font-semibold text-slate-900">Filters</h3>
          <form class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3" @submit=${(event: Event) => this.handlePostgresInspectFilters(event)}>
            ${(data?.columns ?? []).map((column) => html`
              <label class="space-y-2 text-sm text-slate-600">
                <span>${column.name}</span>
                <input
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                  name="${column.name}"
                  value="${data?.filters[column.name] ?? ''}"
                  placeholder="ILIKE on ${column.name}"
                />
              </label>
            `)}
            <div class="md:col-span-2 xl:col-span-3 flex gap-3">
              <button class="rounded-full bg-aura-navy px-4 py-3 text-sm font-medium text-white hover:bg-aura-blue" type="submit">Apply filters</button>
              ${route
                ? html`
                    <button
                      class="rounded-full border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      type="button"
                      @click=${() => this.navigate({ ...route, page: 1, filters: {} })}
                    >
                      Clear
                    </button>
                  `
                : null}
            </div>
          </form>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h3 class="text-lg font-semibold text-slate-900">Records</h3>
            <div class="flex items-center gap-3 text-sm text-slate-500">
              <button
                class="rounded-full border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!canGoBack || !route}
                @click=${() => route && this.navigate({ ...route, page: Math.max(1, (data?.pagination.page ?? 1) - 1) })}
              >
                Previous
              </button>
              <span>page ${formatInteger(data?.pagination.page)} / ${formatInteger(data?.pagination.totalPages)}</span>
              <button
                class="rounded-full border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!canGoNext || !route}
                @click=${() => route && this.navigate({ ...route, page: (data?.pagination.page ?? 1) + 1 })}
              >
                Next
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  ${(data?.columns ?? []).map((column) => html`<th class="px-6 py-3 font-medium">${column.name}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${(data?.rows ?? []).length > 0
                  ? (data?.rows ?? []).map((row) => html`
                      <tr class="border-t border-slate-100 align-top">
                        ${(data?.columns ?? []).map((column) => html`
                          <td class="max-w-xs px-6 py-4 text-slate-700">
                            <div class="break-words">${formatMonitorValue(row[column.name])}</div>
                          </td>
                        `)}
                      </tr>
                    `)
                  : html`
                      <tr>
                        <td class="px-6 py-8 text-sm text-slate-500" colspan="${Math.max(data?.columns.length ?? 0, 1)}">No rows matched the current filters.</td>
                      </tr>
                    `}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderPostgresDetails() {
    const data = this.postgresDetailsData;
    const route = this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'details' ? this.currentRoute : null;
    const indexes = (data?.indexes ?? []).map((index) => ({
      ...index,
      columns: Array.isArray(index.columns)
        ? index.columns
        : typeof (index.columns as unknown) === 'string'
          ? String(index.columns).split(',').map((entry: string) => entry.trim()).filter((entry: string) => entry.length > 0)
          : [],
    }));

    return html`
      <section class="space-y-6">
        ${route ? this.renderBreadcrumb(route) : null}
        ${this.renderRouteError()}
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Rows', formatInteger(data?.metrics.rowCount), data?.databaseName ?? 'database')}
          ${this.renderMetricCard('Table size', formatBytes(data?.metrics.totalSizeBytes), data?.tableName ?? 'table')}
          ${this.renderMetricCard('Columns', formatInteger(data?.columns.length), 'Fields discovered')}
          ${this.renderMetricCard('Indexes', formatInteger(indexes.length), `PK ${data?.primaryKey.join(', ') || 'none'}`)}
        </div>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Architecture metadata</h2>
          <div class="mt-2 text-sm text-slate-500">${data?.description ?? 'No description registered.'}</div>
          <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            ${this.renderMetricCard('Module', data?.moduleId ?? 'n/a', data?.repositoryName ?? 'repository')}
            ${this.renderMetricCard('Storage', this.renderStorageProfile(data?.storageProfile), data?.backupHot ? 'hot backup enabled' : 'no hot backup')}
            ${this.renderMetricCard('Repository', data?.repositoryName ?? 'n/a', data?.tableName ?? 'table')}
            ${this.renderMetricCard('Backup', data?.backupHot ? 'yes' : 'no', 'From schema registry')}
          </div>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Fields</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Field</th>
                  <th class="px-6 py-3 font-medium">Type</th>
                  <th class="px-6 py-3 font-medium">Nullable</th>
                  <th class="px-6 py-3 font-medium">Default</th>
                </tr>
              </thead>
              <tbody>
                ${(data?.columns ?? []).map((column) => html`
                  <tr class="border-t border-slate-100">
                    <td class="px-6 py-4 font-medium text-slate-900">${column.name}</td>
                    <td class="px-6 py-4 text-slate-700">${column.dataType}</td>
                    <td class="px-6 py-4 text-slate-700">${column.isNullable ? 'yes' : 'no'}</td>
                    <td class="px-6 py-4 text-slate-700">${column.defaultValue ?? 'n/a'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Keys and indexes</h2>
          <div class="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
            <div class="text-sm uppercase tracking-wide text-slate-500">Primary key</div>
            <div class="mt-2 text-base font-semibold text-slate-900">${data?.primaryKey.join(', ') || 'none'}</div>
          </div>
          <div class="mt-4 space-y-3">
            ${indexes.map((index) => html`
              <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                <div class="flex items-center justify-between gap-3">
                  <strong class="text-sm text-slate-900">${index.name}</strong>
                  <span class="rounded-full ${index.unique ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'} px-2 py-1 text-xs font-medium">${index.unique ? 'unique' : 'non-unique'}</span>
                </div>
                <div class="mt-2 text-sm text-slate-600">${index.method} · ${index.columns.join(', ') || 'expression index'}</div>
              </div>
            `)}
          </div>
        </article>
      </section>
    `;
  }

  private renderDynamoInspect() {
    const data = this.dynamoInspectData;
    const route = this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'inspect' ? this.currentRoute : null;
    const canGoPrevious = Boolean(route && (route.cursor || route.cursorStack.length > 0));

    return html`
      <section class="space-y-6">
        ${route ? this.renderBreadcrumb(route) : null}
        ${this.renderRouteError()}
        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Inspect ${data?.tableName ?? 'table'}</h2>
              <p class="mt-1 text-sm text-slate-500">DynamoDB scan page with scalar server-side filters.</p>
              <p class="mt-1 text-sm text-slate-500">${data?.description ?? 'No description registered.'}</p>
            </div>
            <div class="text-sm text-slate-500">page size ${formatInteger(data?.pagination.pageSize)} · metadata counters are approximate</div>
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 class="text-base font-semibold text-slate-900">Filters</h3>
          <form class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3" @submit=${(event: Event) => this.handleDynamoInspectFilters(event)}>
            ${(data?.columns ?? []).map((column) => html`
              <label class="space-y-2 text-sm text-slate-600">
                <span>${column.name}${column.filterable ? '' : ' (view only)'}</span>
                <input
                  class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-100"
                  name="${column.name}"
                  value="${data?.filters[column.name] ?? ''}"
                  ?disabled=${!column.filterable}
                  placeholder="${column.filterable ? `Filter ${column.name}` : 'Complex field'}"
                />
              </label>
            `)}
            <div class="md:col-span-2 xl:col-span-3 flex gap-3">
              <button class="rounded-full bg-aura-navy px-4 py-3 text-sm font-medium text-white hover:bg-aura-blue" type="submit">Apply filters</button>
              ${route
                ? html`
                    <button
                      class="rounded-full border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      type="button"
                      @click=${() => this.navigate({ ...route, cursor: undefined, cursorStack: [], filters: {} })}
                    >
                      Clear
                    </button>
                  `
                : null}
            </div>
          </form>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h3 class="text-lg font-semibold text-slate-900">Items</h3>
            <div class="flex items-center gap-3 text-sm text-slate-500">
              <button
                class="rounded-full border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!canGoPrevious || !route}
                @click=${() => {
                  if (!route) {
                    return;
                  }
                  const nextStack = [...route.cursorStack];
                  const previousCursor = nextStack.pop();
                  this.navigate({
                    ...route,
                    cursor: previousCursor,
                    cursorStack: nextStack,
                  });
                }}
              >
                Previous
              </button>
              <button
                class="rounded-full border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                ?disabled=${!(data?.pagination.hasNextPage) || !route}
                @click=${() => {
                  if (!route || !data?.pagination.nextCursor) {
                    return;
                  }
                  this.navigate({
                    ...route,
                    cursor: data.pagination.nextCursor,
                    cursorStack: route.cursor ? [...route.cursorStack, route.cursor] : [...route.cursorStack],
                  });
                }}
              >
                Next
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  ${(data?.columns ?? []).map((column) => html`<th class="px-6 py-3 font-medium">${column.name}</th>`)}
                </tr>
              </thead>
              <tbody>
                ${(data?.rows ?? []).length > 0
                  ? (data?.rows ?? []).map((row) => html`
                      <tr class="border-t border-slate-100 align-top">
                        ${(data?.columns ?? []).map((column) => html`
                          <td class="max-w-xs px-6 py-4 text-slate-700">
                            <div class="break-words">${formatMonitorValue(row[column.name])}</div>
                          </td>
                        `)}
                      </tr>
                    `)
                  : html`
                      <tr>
                        <td class="px-6 py-8 text-sm text-slate-500" colspan="${Math.max(data?.columns.length ?? 0, 1)}">No items matched the current filters.</td>
                      </tr>
                    `}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderDynamoDetails() {
    const data = this.dynamoDetailsData;
    const route = this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'details' ? this.currentRoute : null;

    return html`
      <section class="space-y-6">
        ${route ? this.renderBreadcrumb(route) : null}
        ${this.renderRouteError()}
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Status', data?.summary.tableStatus ?? 'n/a', data?.tableName ?? 'table')}
          ${this.renderMetricCard('Items', `~${formatInteger(data?.summary.itemCount)}`, 'Approximate item count from DescribeTable')}
          ${this.renderMetricCard('Table size', `~${formatBytes(data?.summary.tableSizeBytes)}`, 'Approximate physical table size')}
          ${this.renderMetricCard('Indexes', formatInteger((data?.globalSecondaryIndexes.length ?? 0) + (data?.localSecondaryIndexes.length ?? 0)), data?.summary.billingMode ?? 'billing mode')}
        </div>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Architecture metadata</h2>
          <div class="mt-2 text-sm text-slate-500">${data?.description ?? 'No description registered.'}</div>
          <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            ${this.renderMetricCard('Module', data?.moduleId ?? 'n/a', data?.repositoryName ?? 'repository')}
            ${this.renderMetricCard('Storage', this.renderStorageProfile(data?.storageProfile), data?.backupHot ? 'hot backup enabled' : 'no hot backup')}
            ${this.renderMetricCard('Repository', data?.repositoryName ?? 'n/a', data?.tableName ?? 'table')}
            ${this.renderMetricCard('Backup', data?.backupHot ? 'yes' : 'no', 'From schema registry')}
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Key schema</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Partition key</div>
              <div class="mt-2 text-xl font-semibold text-slate-900">${data?.keys.partitionKey ?? 'n/a'}</div>
            </div>
            <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div class="text-sm uppercase tracking-wide text-slate-500">Sort key</div>
              <div class="mt-2 text-xl font-semibold text-slate-900">${data?.keys.sortKey ?? 'n/a'}</div>
            </div>
          </div>
        </article>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Attribute definitions</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Attribute</th>
                  <th class="px-6 py-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                ${(data?.attributeDefinitions ?? []).map((attribute) => html`
                  <tr class="border-t border-slate-100">
                    <td class="px-6 py-4 font-medium text-slate-900">${attribute.name}</td>
                    <td class="px-6 py-4 text-slate-700">${attribute.type}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>

        <div class="grid gap-6 xl:grid-cols-2">
          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Global secondary indexes</h2>
            <div class="mt-4 space-y-3">
              ${(data?.globalSecondaryIndexes ?? []).length > 0
                ? (data?.globalSecondaryIndexes ?? []).map((index) => html`
                    <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <strong class="text-sm text-slate-900">${index.name}</strong>
                      <div class="mt-2 text-sm text-slate-600">${index.projectionType ?? 'n/a'} · ${index.keys.join(', ') || 'n/a'}</div>
                    </div>
                  `)
                : html`<div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-500">No GSIs reported.</div>`}
            </div>
          </article>

          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Local secondary indexes</h2>
            <div class="mt-4 space-y-3">
              ${(data?.localSecondaryIndexes ?? []).length > 0
                ? (data?.localSecondaryIndexes ?? []).map((index) => html`
                    <div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                      <strong class="text-sm text-slate-900">${index.name}</strong>
                      <div class="mt-2 text-sm text-slate-600">${index.projectionType ?? 'n/a'} · ${index.keys.join(', ') || 'n/a'}</div>
                    </div>
                  `)
                : html`<div class="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-500">No LSIs reported.</div>`}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  private handleTraceSearch(event: Event) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const requestId = (formData.get('requestId') as string | null)?.trim() || undefined;
    const traceId = (formData.get('traceId') as string | null)?.trim() || undefined;
    void this.navigate({ section: 'trace', kind: 'section', requestId, traceId });
  }

  private renderProcess() {
    const data = this.processData;
    const uptime = data ? `${Math.floor(data.process.uptimeSeconds / 3600)}h ${Math.floor((data.process.uptimeSeconds % 3600) / 60)}m ${data.process.uptimeSeconds % 60}s` : 'n/a';

    return html`
      <section class="space-y-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${this.renderMetricCard('Heap used', data ? `${data.memory.heapUsedMb} MB` : 'n/a', `${formatPercent(data?.memory.heapUsedPercent)} of heap total`)}
          ${this.renderMetricCard('Heap total', data ? `${data.memory.heapTotalMb} MB` : 'n/a', `RSS ${data ? `${data.memory.rssMb} MB` : 'n/a'}`)}
          ${this.renderMetricCard('System free', data ? `${data.system.freememMb} MB` : 'n/a', `${formatPercent(data?.system.freeMemPercent)} of ${data ? `${data.system.totalMemMb} MB` : 'n/a'}`)}
          ${this.renderMetricCard('Uptime', uptime, `PID ${data?.process.pid ?? 'n/a'}`)}
        </div>

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          ${this.renderMetricCard('CPU count', formatInteger(data?.system.cpuCount), 'Logical processors')}
          ${this.renderMetricCard('Load avg 1m', data ? String(data.system.loadAvg1m) : 'n/a', `5m ${data?.system.loadAvg5m ?? 'n/a'} · 15m ${data?.system.loadAvg15m ?? 'n/a'}`)}
          ${this.renderMetricCard('Node version', data?.process.nodeVersion ?? 'n/a', 'Runtime version')}
        </div>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Memory breakdown</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            ${this.renderMetricCard('Heap used', data ? `${data.memory.heapUsedMb} MB` : 'n/a', `${formatPercent(data?.memory.heapUsedPercent)} utilization`)}
            ${this.renderMetricCard('Heap total', data ? `${data.memory.heapTotalMb} MB` : 'n/a', 'V8 heap allocation')}
            ${this.renderMetricCard('RSS', data ? `${data.memory.rssMb} MB` : 'n/a', 'Resident set size')}
            ${this.renderMetricCard('External', data ? `${data.memory.externalMb} MB` : 'n/a', 'C++ objects bound to JS')}
          </div>
        </article>
      </section>
    `;
  }

  private renderTrace() {
    const data = this.traceData;
    const route = this.currentRoute.section === 'trace' ? this.currentRoute : null;
    const entries = data?.entries ?? [];

    return html`
      <section class="space-y-6">
        ${this.renderRouteError()}
        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900">Search trace</h2>
          <form class="mt-4 grid gap-4 md:grid-cols-2" @submit=${(event: Event) => this.handleTraceSearch(event)}>
            <label class="space-y-2 text-sm text-slate-600">
              <span>Request ID</span>
              <input
                class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                name="requestId"
                value="${route?.requestId ?? ''}"
                placeholder="Search by requestId"
              />
            </label>
            <label class="space-y-2 text-sm text-slate-600">
              <span>Trace ID</span>
              <input
                class="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
                name="traceId"
                value="${route?.traceId ?? ''}"
                placeholder="Search by traceId"
              />
            </label>
            <div class="md:col-span-2">
              <button class="rounded-full bg-aura-navy px-5 py-3 text-sm font-medium text-white hover:bg-aura-blue" type="submit">Search</button>
            </div>
          </form>
        </article>

        ${data
          ? html`
            <div class="grid gap-4 md:grid-cols-3">
              ${this.renderMetricCard('Entries', formatInteger(data.totalCount), `requestId ${data.requestId ?? 'n/a'}`)}
              ${this.renderMetricCard('Trace ID', data.traceId ?? 'n/a', 'Correlated trace identifier')}
              ${this.renderMetricCard('Users', data.entries.length > 0 ? [...new Set(entries.map((e) => e.userId))].join(', ') : 'n/a', 'Unique user IDs in trace')}
            </div>

            <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div class="border-b border-slate-200 px-6 py-4">
                <h2 class="text-lg font-semibold text-slate-900">Execution timeline</h2>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead class="bg-slate-50 text-slate-600">
                    <tr>
                      <th class="px-6 py-3 font-medium">Routine</th>
                      <th class="px-6 py-3 font-medium">Status</th>
                      <th class="px-6 py-3 font-medium">Duration</th>
                      <th class="px-6 py-3 font-medium">User</th>
                      <th class="px-6 py-3 font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${entries.length > 0
                      ? entries.map((entry) => html`
                          <tr class="border-t border-slate-100 align-top">
                            <td class="px-6 py-4">
                              <div class="font-medium text-slate-900">${entry.routine}</div>
                              ${entry.errorCode
                                ? html`<div class="mt-1 text-xs text-rose-600">${entry.errorCode}</div>`
                                : null}
                              ${entry.errorStack
                                ? html`
                                    <details class="mt-2">
                                      <summary class="cursor-pointer text-xs text-rose-500">stack trace</summary>
                                      <pre class="mt-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-all text-xs text-rose-700">${entry.errorStack}</pre>
                                    </details>
                                  `
                                : null}
                            </td>
                            <td class="px-6 py-4">
                              <span class="${entry.ok ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800' : 'rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800'}">
                                ${entry.statusCode} ${entry.statusGroup}
                              </span>
                            </td>
                            <td class="px-6 py-4 text-slate-700">${formatInteger(entry.durationMs)} ms</td>
                            <td class="px-6 py-4 text-slate-600">${entry.userId}</td>
                            <td class="px-6 py-4 text-slate-500">${formatDateTime(entry.startedAt)}</td>
                          </tr>
                        `)
                      : html`
                          <tr>
                            <td class="px-6 py-8 text-sm text-slate-500" colspan="5">No entries found for this trace.</td>
                          </tr>
                        `}
                  </tbody>
                </table>
              </div>
            </article>
          `
          : null}
      </section>
    `;
  }

  /** LLM-friendly plain-text block for one abend entry (paste-ready). */
  private buildAbendClipboardText(entry: MonitorAbendResponse['entries'][number]): string {
    const lines = [
      '### BFF abend',
      `- routine: ${entry.routine}`,
      `- module: ${entry.module} | status: ${entry.statusCode} ${entry.statusGroup}${entry.errorCode ? ` | errorCode: ${entry.errorCode}` : ''}`,
      `- started: ${entry.startedAt} | finished: ${entry.finishedAt} | duration: ${entry.durationMs} ms`,
      `- user: ${entry.userId} | requestId: ${entry.requestId} | traceId: ${entry.traceId}`,
    ];
    if (entry.errorStack) {
      lines.push('', 'stack trace:', '```', entry.errorStack, '```');
    }
    return lines.join('\n');
  }

  private async copyAbendEntry(entry: MonitorAbendResponse['entries'][number]) {
    try {
      await navigator.clipboard.writeText(this.buildAbendClipboardText(entry));
      this.copiedAbendId = entry.id;
      window.setTimeout(() => {
        if (this.copiedAbendId === entry.id) this.copiedAbendId = undefined;
      }, 2000);
    } catch (err) {
      console.error('[monitor] clipboard copy failed:', err);
    }
  }

  /** LLM-friendly plain-text block for one frontend error entry. */
  private buildClientErrorClipboardText(entry: MonitorClientErrorsResponse['entries'][number]): string {
    const meta = (entry.metadata ?? {}) as { filename?: string; lineno?: number; colno?: number; stack?: string; repeatCount?: number };
    const lines = [
      '### Frontend error',
      `- type: ${entry.eventType} | message: ${entry.label}`,
      `- occurred: ${entry.recordedAt}${meta.repeatCount && meta.repeatCount > 1 ? ` | repeated: ${meta.repeatCount}x` : ''}`,
      `- source: ${meta.filename ?? 'n/a'}${meta.lineno ? `:${meta.lineno}:${meta.colno ?? 0}` : ''}`,
      `- user: ${entry.userId} | requestId: ${entry.requestId} | traceId: ${entry.traceId}`,
    ];
    if (meta.stack) {
      lines.push('', 'stack trace:', '```', meta.stack, '```');
    }
    return lines.join('\n');
  }

  private async copyClientErrorEntry(entry: MonitorClientErrorsResponse['entries'][number]) {
    try {
      await navigator.clipboard.writeText(this.buildClientErrorClipboardText(entry));
      this.copiedAbendId = entry.id;
      window.setTimeout(() => {
        if (this.copiedAbendId === entry.id) this.copiedAbendId = undefined;
      }, 2000);
    } catch (err) {
      console.error('[monitor] clipboard copy failed:', err);
    }
  }

  private renderClientErrors() {
    const data = this.clientErrorsData;
    if (!data) return null;
    const entries = data.entries;

    return html`
      <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h2 class="text-lg font-semibold text-slate-900">Frontend errors (last ${data.sinceHours}h)</h2>
          <span class="text-sm text-slate-500">${formatInteger(data.totalCount)} event(s) reported by browsers</span>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr>
                <th class="px-6 py-3 font-medium">Message</th>
                <th class="px-6 py-3 font-medium">Type</th>
                <th class="px-6 py-3 font-medium">User</th>
                <th class="px-6 py-3 font-medium">Occurred</th>
              </tr>
            </thead>
            <tbody>
              ${entries.length > 0
                ? entries.map((entry) => {
                    const meta = (entry.metadata ?? {}) as { filename?: string; lineno?: number; stack?: string; repeatCount?: number };
                    return html`
                      <tr class="border-t border-slate-100 align-top">
                        <td class="px-6 py-4">
                          <div class="flex items-start gap-2">
                            <div class="font-medium text-slate-900">${entry.label}</div>
                            ${meta.repeatCount && meta.repeatCount > 1
                              ? html`<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">${meta.repeatCount}x</span>`
                              : null}
                            <button
                              class="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium ${this.copiedAbendId === entry.id ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'text-slate-600 hover:bg-slate-100'}"
                              title="Copy this error as an LLM-ready text block"
                              @click=${() => void this.copyClientErrorEntry(entry)}
                            >${this.copiedAbendId === entry.id ? 'Copied!' : 'Copy'}</button>
                          </div>
                          ${meta.filename
                            ? html`<div class="mt-1 text-xs text-slate-500">${meta.filename}${meta.lineno ? `:${meta.lineno}` : ''}</div>`
                            : null}
                          ${meta.stack
                            ? html`
                                <details class="mt-2">
                                  <summary class="cursor-pointer text-xs text-rose-500">stack trace</summary>
                                  <pre class="mt-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-all text-xs text-rose-700">${meta.stack}</pre>
                                </details>
                              `
                            : null}
                        </td>
                        <td class="px-6 py-4">
                          <span class="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">${entry.eventType}</span>
                        </td>
                        <td class="px-6 py-4 text-slate-600">${entry.userId}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-700" title="${entry.recordedAt}">${formatDateTime(entry.recordedAt)}</td>
                      </tr>
                    `;
                  })
                : html`
                    <tr>
                      <td class="px-6 py-8 text-sm text-slate-500" colspan="4">No frontend errors reported in the last ${data.sinceHours}h.</td>
                    </tr>
                  `}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  private renderAbend() {
    const data = this.abendData;
    const entries = data?.entries ?? [];
    const route = this.currentRoute.section === 'abend' ? this.currentRoute : null;

    return html`
      <section class="space-y-6">
        ${this.renderRouteError()}

        ${data
          ? html`
            <div class="grid gap-4 md:grid-cols-3">
              ${this.renderMetricCard('Total failures', formatInteger(data.totalCount), 'Failed BFF executions')}
              ${this.renderMetricCard('Modules affected', formatInteger(new Set(entries.map((e) => e.module)).size), 'Distinct modules with errors')}
              ${this.renderMetricCard('With stack trace', formatInteger(entries.filter((e) => e.errorStack).length), 'Entries with captured stack')}
            </div>
          `
          : null}

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-slate-900">Failed executions</h2>
            <form class="flex gap-3" @submit=${(event: Event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget as HTMLFormElement);
              const mod = String(formData.get('module') ?? '').trim() || undefined;
              void this.navigate({ section: 'abend', kind: 'section', module: mod });
            }}>
              <input
                class="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900"
                name="module"
                value="${route?.module ?? ''}"
                placeholder="Filter by module"
              />
              <button class="rounded-full bg-aura-navy px-4 py-2 text-sm font-medium text-white hover:bg-aura-blue" type="submit">Filter</button>
            </form>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-6 py-3 font-medium">Routine</th>
                  <th class="px-6 py-3 font-medium">Status</th>
                  <th class="px-6 py-3 font-medium">Duration</th>
                  <th class="px-6 py-3 font-medium">User</th>
                  <th class="px-6 py-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                ${entries.length > 0
                  ? entries.map((entry) => html`
                      <tr class="border-t border-slate-100 align-top">
                        <td class="px-6 py-4">
                          <div class="flex items-start gap-2">
                            <div class="font-medium text-slate-900">${entry.routine}</div>
                            <button
                              class="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-medium ${this.copiedAbendId === entry.id ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'text-slate-600 hover:bg-slate-100'}"
                              title="Copy this abend as an LLM-ready text block"
                              @click=${() => void this.copyAbendEntry(entry)}
                            >${this.copiedAbendId === entry.id ? 'Copied!' : 'Copy'}</button>
                          </div>
                          ${entry.errorCode
                            ? html`<div class="mt-1 text-xs font-medium text-rose-600">${entry.errorCode}</div>`
                            : null}
                          ${entry.errorStack
                            ? html`
                                <details class="mt-2">
                                  <summary class="cursor-pointer text-xs text-rose-500">stack trace</summary>
                                  <div class="mt-2 text-xs text-slate-500">occurred at ${formatDateTime(entry.startedAt)} (${entry.startedAt})</div>
                                  <pre class="mt-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-all text-xs text-rose-700">${entry.errorStack}</pre>
                                </details>
                              `
                            : null}
                        </td>
                        <td class="px-6 py-4">
                          <span class="rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800">
                            ${entry.statusCode} ${entry.statusGroup}
                          </span>
                        </td>
                        <td class="px-6 py-4 text-slate-700">${formatInteger(entry.durationMs)} ms</td>
                        <td class="px-6 py-4 text-slate-600">${entry.userId}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-slate-700" title="${entry.startedAt}">${formatDateTime(entry.startedAt)}</td>
                      </tr>
                    `)
                  : html`
                      <tr>
                        <td class="px-6 py-8 text-sm text-slate-500" colspan="5">No failed executions found${route?.module ? ` for module "${route.module}"` : ''}.</td>
                      </tr>
                    `}
              </tbody>
            </table>
          </div>
        </article>

        ${this.renderClientErrors()}
      </section>
    `;
  }

  private async handleRunTests(scope: { moduleId?: string; page?: string }) {
    if (this.testsRunning) return;
    if (!this.testsData?.executionEnabled) return;
    this.testsRunning = true;
    this.status = 'Running BFF tests...';
    try {
      await runBlockingUiAction(
        async (signal) => {
          const response = await runMonitorTests(scope, { mode: 'blocking', signal });
          if (!response.ok || !response.data) {
            throw this.toBlockingError('Could not run tests.', response.error);
          }
          const run = response.data;
          this.status = `Run finished: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped`;
          // Refresh the list so recentRuns reflects the new run.
          const list = await loadMonitorTestsList({ signal });
          if (list.ok && list.data) this.testsData = list.data;
        },
        {
          busyLabel: 'Executando testes...',
          errorTitle: 'Nao foi possivel executar os testes',
          retry: () => this.handleRunTests(scope),
        },
      );
    } catch {
      // handled by runBlockingUiAction UI
    } finally {
      this.testsRunning = false;
    }
  }

  private renderTestStatusBadge(status: 'pass' | 'fail' | 'skipped') {
    const cls = status === 'pass'
      ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800'
      : status === 'fail'
        ? 'rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-800'
        : 'rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600';
    return html`<span class="${cls}">${status}</span>`;
  }

  private renderTests() {
    const data = this.testsData;
    if (!data) return null;
    const enabled = data.executionEnabled && !this.testsRunning;
    const runButton = (label: string, scope: { moduleId?: string; page?: string }) => html`
      <button
        class="rounded-full px-4 py-2 text-xs font-medium text-white transition ${data.executionEnabled ? 'bg-aura-navy hover:bg-aura-blue' : 'cursor-not-allowed bg-slate-300'}"
        ?disabled=${!enabled}
        @click=${() => this.handleRunTests(scope)}
      >${label}</button>`;
    const lastRun = data.recentRuns[0];

    return html`
      <section class="space-y-6">
        ${this.renderRouteError()}
        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Generated BFF tests</h2>
              <p class="mt-1 text-sm text-slate-500">
                Declarative test cases generated per page (page11). Each case runs through the real
                /execBff pipeline with source=test.
              </p>
            </div>
            ${runButton('Run all', {})}
          </div>
          ${data.executionEnabled
            ? null
            : html`<p class="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Execution disabled outside development (appEnv: ${data.appEnv}). Showing discovered tests and history only.</p>`}
        </article>

        ${data.modules.length === 0
          ? html`<article class="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No generated test files found in config.json (modules[].frontend.pageTests).</article>`
          : data.modules.map((module) => html`
            <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
                <h3 class="text-base font-semibold text-slate-900">${module.moduleId} <span class="text-xs font-normal text-slate-400">· project ${module.projectId}</span></h3>
                ${runButton('Run module', { moduleId: module.moduleId })}
              </div>
              <div class="divide-y divide-slate-100">
                ${module.pages.map((page) => html`
                  <div class="px-6 py-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div class="font-medium text-slate-900">${page.page} <span class="text-xs font-normal text-slate-400">· ${page.variant} · ${page.cases.length} case(s)</span></div>
                        ${page.loadError ? html`<div class="mt-1 text-xs text-rose-600">load error: ${page.loadError}</div>` : null}
                      </div>
                      ${runButton('Run page', { moduleId: module.moduleId, page: page.page })}
                    </div>
                    <ul class="mt-3 flex flex-wrap gap-2">
                      ${page.cases.map((testCase) => html`
                        <li class="rounded-2xl border border-slate-200 px-3 py-1 text-xs text-slate-600">
                          <span class="font-medium text-slate-800">${testCase.id}</span>
                          ${testCase.mutating ? html`<span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">mutating</span>` : null}
                        </li>
                      `)}
                    </ul>
                  </div>
                `)}
              </div>
            </article>
          `)}

        ${lastRun
          ? html`
            <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
                <h3 class="text-base font-semibold text-slate-900">Last run</h3>
                <span class="text-sm text-slate-500">
                  ${lastRun.passed} passed · ${lastRun.failed} failed · ${lastRun.skipped} skipped · ${formatDateTime(lastRun.finishedAt)}
                </span>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead class="bg-slate-50 text-slate-600">
                    <tr>
                      <th class="px-6 py-3 font-medium">Case</th>
                      <th class="px-6 py-3 font-medium">Routine</th>
                      <th class="px-6 py-3 font-medium">Status</th>
                      <th class="px-6 py-3 font-medium">Duration</th>
                      <th class="px-6 py-3 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${lastRun.cases.map((testCase) => html`
                      <tr class="border-t border-slate-100 align-top">
                        <td class="px-6 py-4">
                          <div class="font-medium text-slate-900">${testCase.id}</div>
                          <div class="text-xs text-slate-400">${testCase.module} · ${testCase.page}</div>
                        </td>
                        <td class="px-6 py-4 text-slate-600">${testCase.routine}</td>
                        <td class="px-6 py-4">${this.renderTestStatusBadge(testCase.status)}</td>
                        <td class="px-6 py-4 text-slate-500">${testCase.status === 'skipped' ? '—' : `${formatInteger(testCase.durationMs)} ms`}</td>
                        <td class="px-6 py-4 text-xs text-rose-600">
                          ${testCase.status === 'fail'
                            ? html`<div>${testCase.reason || testCase.errorCode || 'failed'}</div>${testCase.errorMessage ? html`<div class="mt-1 text-rose-500">${testCase.errorMessage}</div>` : null}`
                            : testCase.errorCode ?? ''}
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            </article>
          `
          : html`<article class="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No runs yet${data.executionEnabled ? ' — use Run all / Run module / Run page.' : '.'}</article>`}
      </section>
    `;
  }

  private renderMetricCard(title: string, value: string, caption: string) {
    return html`
      <article class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="text-sm font-medium uppercase tracking-wide text-slate-500">${title}</div>
        <div class="mt-3 text-3xl font-semibold text-slate-900">${value}</div>
        <div class="mt-2 text-sm text-slate-500">${caption}</div>
      </article>
    `;
  }

  render() {
    const routeTitle = getRouteLabel(this.currentRoute ?? { section: 'overview', kind: 'section' });
    return html`
      <section class="space-y-6">
        <header class="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div>
            <div class="text-sm uppercase tracking-[0.18em] text-slate-500">Monitor</div>
            <h1 class="text-2xl font-semibold text-slate-950">${routeTitle}</h1>
            <p class="mt-1 text-sm text-slate-500">${this.status ?? 'Preparing monitor module...'}</p>
          </div>
          <button class="rounded-full bg-aura-navy px-4 py-3 text-sm font-medium text-white transition hover:bg-aura-blue" @click=${() => this.refreshCurrentSection()}>
            Refresh section
          </button>
        </header>

        ${this.currentRoute.section === 'architecture' && this.currentRoute.kind === 'section'
          ? this.renderArchitecture()
          : this.currentRoute.section === 'operations' && this.currentRoute.kind === 'section'
          ? this.renderOperations()
          : this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'section'
          ? this.renderPostgres()
          : this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'section'
            ? this.renderDynamodb()
            : this.currentRoute.section === 'process' && this.currentRoute.kind === 'section'
              ? this.renderProcess()
              : this.currentRoute.section === 'abend' && this.currentRoute.kind === 'section'
                ? this.renderAbend()
                : this.currentRoute.section === 'trace' && this.currentRoute.kind === 'section'
                ? this.renderTrace()
                : this.currentRoute.section === 'tests' && this.currentRoute.kind === 'section'
                ? this.renderTests()
                : this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'inspect'
                  ? this.renderPostgresInspect()
                  : this.currentRoute.section === 'postgres' && this.currentRoute.kind === 'details'
                    ? this.renderPostgresDetails()
                    : this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'inspect'
                      ? this.renderDynamoInspect()
                      : this.currentRoute.section === 'dynamodb' && this.currentRoute.kind === 'details'
                        ? this.renderDynamoDetails()
                        : this.renderOverview()}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-home-page', MonitorWebDesktopHomePage);
