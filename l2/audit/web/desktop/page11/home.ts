/// <mls fileReference="_102034_/l2/audit/web/desktop/page11/home.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import type { AuraInteractionMode, AuraNormalizedError } from '/_102029_/l2/contracts/bootstrap.js';
import {
  beginExpectedNavigationLoad,
  bindExpectedNavigationLoad,
  consumeExpectedNavigationLoad,
  runBlockingUiAction,
} from '/_102029_/l2/interactionRuntime.js';
import { loadAuditLog } from '/_102034_/l2/audit/web/shared/auditLog.js';
import { loadAuditLogDetails } from '/_102034_/l2/audit/web/shared/auditLogDetails.js';
import { loadAuditHome } from '/_102034_/l2/audit/web/shared/home.js';
import { loadAuditStatusHistory } from '/_102034_/l2/audit/web/shared/statusHistory.js';
import { formatDateTime, formatInteger, formatJson } from '/_102034_/l2/audit/web/shared/formatters.js';
import type { AuditHomeResponse } from '/_102034_/l2/audit/shared/contracts/home.js';
import type { AuditLogDetailsResponse, AuditLogResponse } from '/_102034_/l2/audit/shared/contracts/audit-log.js';
import type { AuditStatusHistoryResponse } from '/_102034_/l2/audit/shared/contracts/status-history.js';

function traceLazy(event: string, details?: Record<string, unknown>) {
  if (!window.isTraceLazy) {
    return;
  }
  console.log('[traceLazy][audit]', event, details ?? {});
}

type AuditSection = 'overview' | 'audit-log' | 'status-history';

function parseSection(locationValue: Location): AuditSection {
  if (locationValue.pathname === '/audit/audit-log') {
    return 'audit-log';
  }
  if (locationValue.pathname === '/audit/status-history') {
    return 'status-history';
  }
  return 'overview';
}

function readQuery(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key)?.trim() ?? '';
}

function readPage(searchParams: URLSearchParams) {
  return Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
}

function buildHref(section: AuditSection, updates?: Record<string, string | number | undefined>) {
  const pathname = section === 'overview' ? '/audit' : `/audit/${section}`;
  const searchParams = new URLSearchParams(window.location.search);
  Object.entries(updates ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      searchParams.delete(key);
      return;
    }
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

function card(title: string, value: string, detail: string) {
  return html`
    <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">${title}</p>
      <p class="mt-3 text-3xl font-semibold text-slate-900">${value}</p>
      <p class="mt-2 text-sm text-slate-500">${detail}</p>
    </section>
  `;
}

export class AuditWebDesktopHomePage extends LitElement {
  static properties = {
    currentSection: { state: true },
    status: { state: true },
    routeError: { state: true },
    homeData: { state: true },
    auditLogData: { state: true },
    statusHistoryData: { state: true },
    auditLogDetails: { state: true },
  };

  currentSection: AuditSection = 'overview';
  status = 'Preparing audit module...';
  routeError?: string;
  declare homeData?: AuditHomeResponse;
  declare auditLogData?: AuditLogResponse;
  declare statusHistoryData?: AuditStatusHistoryResponse;
  declare auditLogDetails?: AuditLogDetailsResponse;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('popstate', this.handlePopState);
    void this.handleRouteChange();
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.handlePopState);
    super.disconnectedCallback();
  }

  private readonly handlePopState = () => {
    void this.handleRouteChange();
  };

  private async handleRouteChange() {
    traceLazy('handleRouteChange', {
      pathname: window.location.pathname,
      search: window.location.search,
    });
    const pendingLoad = consumeExpectedNavigationLoad();
    const task = this.loadCurrentRoute({
      mode: pendingLoad ? 'blocking' : 'silent',
      signal: pendingLoad?.signal,
    });
    bindExpectedNavigationLoad(pendingLoad, task);
    await task.catch(() => undefined);
  }

  private async navigateWithinModule(href: string, signal?: AbortSignal) {
    const pendingLoad = beginExpectedNavigationLoad(signal);
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await pendingLoad;
  }

  private async loadCurrentRoute(options: {
    mode?: AuraInteractionMode;
    signal?: AbortSignal;
  } = {}) {
    traceLazy('loadCurrentRoute.start', {
      pathname: window.location.pathname,
      search: window.location.search,
      mode: options.mode ?? 'silent',
    });
    this.currentSection = parseSection(window.location);
    this.routeError = undefined;
    this.status = `Loading ${this.currentSection}...`;
    this.auditLogDetails = undefined;
    const searchParams = new URLSearchParams(window.location.search);

    try {
      if (this.currentSection === 'overview') {
        const response = await loadAuditHome({
          mode: options.mode,
          signal: options.signal,
        });
        if (!response.ok || !response.data) {
          throw (response.error ?? {
            code: 'UNEXPECTED_ERROR',
            message: 'Could not load audit overview.',
          }) satisfies AuraNormalizedError;
        }
        this.homeData = response.data;
        this.auditLogData = undefined;
        this.statusHistoryData = undefined;
      } else if (this.currentSection === 'audit-log') {
        const response = await loadAuditLog({
          module: readQuery(searchParams, 'module'),
          entityType: readQuery(searchParams, 'entityType'),
          entityId: readQuery(searchParams, 'entityId'),
          actorId: readQuery(searchParams, 'actorId'),
          actorType: readQuery(searchParams, 'actorType'),
          action: readQuery(searchParams, 'action'),
          from: readQuery(searchParams, 'from'),
          to: readQuery(searchParams, 'to'),
          page: readPage(searchParams),
        }, {
          mode: options.mode,
          signal: options.signal,
        });
        if (!response.ok || !response.data) {
          throw (response.error ?? {
            code: 'UNEXPECTED_ERROR',
            message: 'Could not load audit log.',
          }) satisfies AuraNormalizedError;
        }
        this.auditLogData = response.data;
        this.homeData = undefined;
        this.statusHistoryData = undefined;
      } else {
        const response = await loadAuditStatusHistory({
          module: readQuery(searchParams, 'module'),
          entityType: readQuery(searchParams, 'entityType'),
          entityId: readQuery(searchParams, 'entityId'),
          fromStatus: readQuery(searchParams, 'fromStatus'),
          toStatus: readQuery(searchParams, 'toStatus'),
          actorId: readQuery(searchParams, 'actorId'),
          reasonCode: readQuery(searchParams, 'reasonCode'),
          from: readQuery(searchParams, 'from'),
          to: readQuery(searchParams, 'to'),
          page: readPage(searchParams),
        }, {
          mode: options.mode,
          signal: options.signal,
        });
        if (!response.ok || !response.data) {
          throw (response.error ?? {
            code: 'UNEXPECTED_ERROR',
            message: 'Could not load status history.',
          }) satisfies AuraNormalizedError;
        }
        this.statusHistoryData = response.data;
        this.homeData = undefined;
        this.auditLogData = undefined;
      }
      this.status = `Updated ${new Date().toLocaleTimeString('pt-BR')}`;
      traceLazy('loadCurrentRoute.success', {
        section: this.currentSection,
      });
    } catch (error) {
      traceLazy('loadCurrentRoute.error', {
        section: this.currentSection,
        message: error instanceof Error ? error.message : String(error),
      });
      if (options.mode === 'blocking') {
        throw error;
      }
      this.routeError = error instanceof Error ? error.message : String(error);
      this.status = 'Load failed.';
    }
  }

  private handleNavClick(event: Event, section: AuditSection) {
    event.preventDefault();
    const href = buildHref(section);
    const retry = () => this.navigateWithinModule(href);
    void runBlockingUiAction(
      async (signal) => {
        await this.navigateWithinModule(href, signal);
      },
      {
        clearContentWhileBusy: true,
        busyLabel: 'Carregando pagina...',
        errorTitle: 'Nao foi possivel carregar esta pagina',
        retry,
      },
    );
  }

  private handleRefreshClick() {
    void runBlockingUiAction(
      (signal) => this.loadCurrentRoute({
        mode: 'blocking',
        signal,
      }),
      {
        busyLabel: 'Atualizando dados...',
        errorTitle: 'Nao foi possivel atualizar esta pagina',
        retry: () => this.loadCurrentRoute({
          mode: 'blocking',
        }),
      },
    );
  }

  private handleFilterSubmit(event: SubmitEvent, section: AuditSection) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const updates = Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]));
    updates.page = '1';
    const href = buildHref(section, updates);
    const retry = () => this.navigateWithinModule(href);
    void runBlockingUiAction(
      async (signal) => {
        await this.navigateWithinModule(href, signal);
      },
      {
        clearContentWhileBusy: true,
        busyLabel: 'Aplicando filtros...',
        errorTitle: 'Nao foi possivel aplicar os filtros',
        retry,
      },
    );
  }

  private handlePageClick(event: Event, section: AuditSection, page: number) {
    event.preventDefault();
    const href = buildHref(section, { page });
    const retry = () => this.navigateWithinModule(href);
    void runBlockingUiAction(
      async (signal) => {
        await this.navigateWithinModule(href, signal);
      },
      {
        clearContentWhileBusy: true,
        busyLabel: 'Carregando pagina...',
        errorTitle: 'Nao foi possivel carregar esta pagina',
        retry,
      },
    );
  }

  private async loadDiff(id: string, signal?: AbortSignal) {
    this.status = 'Loading remote diff...';
    const response = await loadAuditLogDetails({ id }, {
      mode: 'blocking',
      signal,
    });
    if (!response.ok) {
      throw (response.error ?? {
        code: 'UNEXPECTED_ERROR',
        message: 'Could not load audit details.',
      }) satisfies AuraNormalizedError;
    }
    this.auditLogDetails = response.data ?? undefined;
    this.status = `Updated ${new Date().toLocaleTimeString('pt-BR')}`;
  }

  private handleLoadDiff(id: string) {
    void runBlockingUiAction(
      (signal) => this.loadDiff(id, signal),
      {
        busyLabel: 'Carregando diff...',
        errorTitle: 'Nao foi possivel carregar o diff',
        retry: () => this.loadDiff(id),
      },
    );
  }

  private renderOverview() {
    if (!this.homeData) {
      return html``;
    }

    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${card('Audit Log', formatInteger(this.homeData.summary.auditLog.total), `${formatInteger(this.homeData.summary.auditLog.last24h)} in the last 24h`)}
        ${card('Status History', formatInteger(this.homeData.summary.statusHistory.total), `${formatInteger(this.homeData.summary.statusHistory.last24h)} in the last 24h`)}
        ${card('Modules', formatInteger(this.homeData.distribution.byModule.length), 'Top active modules across both trails')}
        ${card('Entity Types', formatInteger(this.homeData.distribution.byEntityType.length), 'Top tracked entities across both trails')}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Audit Log vs Status History</p>
          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p class="text-sm font-semibold text-amber-900">Audit Log</p>
              <p class="mt-2 text-sm leading-6 text-amber-950">${this.homeData.explanation.auditLog}</p>
            </div>
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p class="text-sm font-semibold text-emerald-900">Status History</p>
              <p class="mt-2 text-sm leading-6 text-emerald-950">${this.homeData.explanation.statusHistory}</p>
            </div>
          </div>
        </article>

        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Environment</p>
          <dl class="mt-4 space-y-3 text-sm text-slate-600">
            <div class="flex items-center justify-between gap-4"><dt>App env</dt><dd class="font-medium text-slate-900">${this.homeData.system.appEnv}</dd></div>
            <div class="flex items-center justify-between gap-4"><dt>Runtime</dt><dd class="font-medium text-slate-900">${this.homeData.system.runtimeMode}</dd></div>
            <div class="flex items-center justify-between gap-4"><dt>Write-behind</dt><dd class="font-medium text-slate-900">${this.homeData.system.writeBehindEnabled ? 'enabled' : 'disabled'}</dd></div>
            <div class="flex items-center justify-between gap-4"><dt>AWS region</dt><dd class="font-medium text-slate-900">${this.homeData.system.awsRegion}</dd></div>
          </dl>
        </article>
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-3">
        ${this.renderNamedCountList('By module', this.homeData.distribution.byModule)}
        ${this.renderNamedCountList('By entity type', this.homeData.distribution.byEntityType)}
        ${this.renderNamedCountList('By actor', this.homeData.distribution.byActorId)}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-2">
        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent audit log events</p>
            <a class="text-sm font-medium text-slate-700 hover:text-slate-950" href="/audit/audit-log" @click=${(event: Event) => this.handleNavClick(event, 'audit-log')}>Open page</a>
          </div>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr>
                  <th class="pb-3 pr-4">Time</th>
                  <th class="pb-3 pr-4">Module</th>
                  <th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                ${this.homeData.recentEvents.auditLog.map((row) => html`
                  <tr class="border-t border-slate-100 text-slate-700">
                    <td class="py-3 pr-4">${formatDateTime(row.createdAt)}</td>
                    <td class="py-3 pr-4">${row.module}</td>
                    <td class="py-3 pr-4">${row.entityType} / ${row.entityId}</td>
                    <td class="py-3 pr-4">${row.action}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>

        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent status transitions</p>
            <a class="text-sm font-medium text-slate-700 hover:text-slate-950" href="/audit/status-history" @click=${(event: Event) => this.handleNavClick(event, 'status-history')}>Open page</a>
          </div>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr>
                  <th class="pb-3 pr-4">Time</th>
                  <th class="pb-3 pr-4">Module</th>
                  <th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Transition</th>
                </tr>
              </thead>
              <tbody>
                ${this.homeData.recentEvents.statusHistory.map((row) => html`
                  <tr class="border-t border-slate-100 text-slate-700">
                    <td class="py-3 pr-4">${formatDateTime(row.createdAt)}</td>
                    <td class="py-3 pr-4">${row.module}</td>
                    <td class="py-3 pr-4">${row.entityType} / ${row.entityId}</td>
                    <td class="py-3 pr-4">${row.fromStatus ?? 'null'} -> ${row.toStatus}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  private renderNamedCountList(title: string, rows: Array<{ label: string; count: number }>) {
    return html`
      <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">${title}</p>
        <ul class="mt-4 space-y-3 text-sm">
          ${rows.map((row) => html`
            <li class="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3 text-slate-700">
              <span class="truncate">${row.label}</span>
              <strong class="text-slate-900">${formatInteger(row.count)}</strong>
            </li>
          `)}
        </ul>
      </article>
    `;
  }

  private renderAuditLog() {
    if (!this.auditLogData) {
      return html``;
    }

    const filters = this.auditLogData.filters;
    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${card('Events', formatInteger(this.auditLogData.summary.total), `Page ${this.auditLogData.summary.page} of ${this.auditLogData.summary.totalPages}`)}
        ${card('Updates', formatInteger(this.auditLogData.summary.updateCount), `${formatInteger(this.auditLogData.summary.createCount)} creates in current filter`)}
        ${card('Actors', formatInteger(this.auditLogData.summary.uniqueActors), 'Unique actors in filtered result')}
        ${card('Modules', formatInteger(this.auditLogData.summary.uniqueModules), 'Modules represented in filtered result')}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-3">
        ${this.renderNamedCountList('By module', this.auditLogData.groups.byModule)}
        ${this.renderNamedCountList('By routine', this.auditLogData.groups.byRoutine)}
        ${this.renderNamedCountList('By action', this.auditLogData.groups.byAction)}
      </section>

      <form class="mt-6 grid gap-3 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4" @submit=${(event: SubmitEvent) => this.handleFilterSubmit(event, 'audit-log')}>
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="module" placeholder="module" .value=${filters.module} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="entityType" placeholder="entityType" .value=${filters.entityType} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="entityId" placeholder="entityId" .value=${filters.entityId} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="actorId" placeholder="actorId" .value=${filters.actorId} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="actorType" placeholder="actorType" .value=${filters.actorType} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="action" placeholder="action" .value=${filters.action} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="from" placeholder="from ISO date" .value=${filters.from} />
        <div class="flex gap-3">
          <input class="min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="to" placeholder="to ISO date" .value=${filters.to} />
          <button class="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700" type="submit">Apply</button>
        </div>
      </form>

      <section class="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr>
                  <th class="pb-3 pr-4">Time</th>
                  <th class="pb-3 pr-4">Module</th>
                  <th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Action</th>
                  <th class="pb-3 pr-4">Actor</th>
                  <th class="pb-3 pr-4">Routine</th>
                  <th class="pb-3 pr-0">Detail</th>
                </tr>
              </thead>
              <tbody>
                ${this.auditLogData.events.map((row) => html`
                  <tr class="border-t border-slate-100 align-top text-slate-700">
                    <td class="py-3 pr-4">${formatDateTime(row.createdAt)}</td>
                    <td class="py-3 pr-4">${row.module}</td>
                    <td class="py-3 pr-4">${row.entityType}<div class="text-xs text-slate-400">${row.entityId}</div></td>
                    <td class="py-3 pr-4">${row.action}</td>
                    <td class="py-3 pr-4">${row.actorId}<div class="text-xs text-slate-400">${row.actorType}</div></td>
                    <td class="py-3 pr-4">${row.routine}</td>
                    <td class="py-3 pr-0">
                      ${row.hasRemoteDiff
                        ? html`<button class="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-500" @click=${() => this.handleLoadDiff(row.id)}>View diff</button>`
                        : html`<span class="text-xs text-slate-400">n/a</span>`}
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
          <div class="mt-4 flex items-center justify-between gap-4 text-sm text-slate-500">
            <button ?disabled=${this.auditLogData.summary.page <= 1} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${(event: Event) => this.handlePageClick(event, 'audit-log', this.auditLogData!.summary.page - 1)}>Previous</button>
            <span>Page ${this.auditLogData.summary.page} of ${this.auditLogData.summary.totalPages}</span>
            <button ?disabled=${this.auditLogData.summary.page >= this.auditLogData.summary.totalPages} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${(event: Event) => this.handlePageClick(event, 'audit-log', this.auditLogData!.summary.page + 1)}>Next</button>
          </div>
        </article>

        <aside class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm xl:sticky xl:top-6 xl:self-start">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Remote diff</p>
              <h3 class="mt-2 text-lg font-semibold text-slate-900">Selected change</h3>
            </div>
            ${this.auditLogDetails?.event
              ? html`<span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">loaded</span>`
              : html`<span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">waiting</span>`}
          </div>

          ${this.auditLogDetails?.event ? html`
            <div class="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
              <div class="flex items-center justify-between gap-4">
                <strong class="text-slate-900">${this.auditLogDetails.event.entityType}</strong>
                <span>${this.auditLogDetails.event.action}</span>
              </div>
              <p class="mt-2 break-all text-xs text-slate-500">${this.auditLogDetails.event.entityId}</p>
              <p class="mt-2 text-xs text-slate-500">${formatDateTime(this.auditLogDetails.event.createdAt)}</p>
            </div>
            <pre class="mt-4 max-h-[70vh] overflow-auto rounded-3xl bg-slate-950 p-5 text-xs leading-6 text-slate-100">${formatJson(this.auditLogDetails.event.diff)}</pre>
          ` : html`
            <div class="mt-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-500">
              Select an \`update\` row and click \`View diff\`.
              <div class="mt-3 text-xs text-slate-400">
                If no diff appears after loading, the remote DynamoDB record is still pending write-behind replication.
              </div>
            </div>
          `}
        </aside>
      </section>
    `;
  }

  private renderStatusHistory() {
    if (!this.statusHistoryData) {
      return html``;
    }

    const filters = this.statusHistoryData.filters;
    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${card('Transitions', formatInteger(this.statusHistoryData.summary.total), `Page ${this.statusHistoryData.summary.page} of ${this.statusHistoryData.summary.totalPages}`)}
        ${card('Entities', formatInteger(this.statusHistoryData.summary.uniqueEntities), 'Entities represented in current filter')}
        ${card('Transitions kinds', formatInteger(this.statusHistoryData.summary.uniqueTransitions), 'Unique from -> to combinations')}
        ${card('Modules', formatInteger(this.statusHistoryData.summary.uniqueModules), 'Modules represented in filtered result')}
      </section>

      <form class="mt-6 grid gap-3 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4" @submit=${(event: SubmitEvent) => this.handleFilterSubmit(event, 'status-history')}>
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="module" placeholder="module" .value=${filters.module} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="entityType" placeholder="entityType" .value=${filters.entityType} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="entityId" placeholder="entityId" .value=${filters.entityId} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="actorId" placeholder="actorId" .value=${filters.actorId} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="fromStatus" placeholder="fromStatus" .value=${filters.fromStatus} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="toStatus" placeholder="toStatus" .value=${filters.toStatus} />
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="reasonCode" placeholder="reasonCode" .value=${filters.reasonCode} />
        <div class="flex gap-3">
          <input class="min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm" name="from" placeholder="from ISO date" .value=${filters.from} />
          <button class="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700" type="submit">Apply</button>
        </div>
        <input class="rounded-2xl border border-slate-200 px-4 py-3 text-sm xl:col-span-4" name="to" placeholder="to ISO date" .value=${filters.to} />
      </form>

      <section class="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr>
                  <th class="pb-3 pr-4">Time</th>
                  <th class="pb-3 pr-4">Module</th>
                  <th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Transition</th>
                  <th class="pb-3 pr-4">Actor</th>
                  <th class="pb-3 pr-0">Reason</th>
                </tr>
              </thead>
              <tbody>
                ${this.statusHistoryData.events.map((row) => html`
                  <tr class="border-t border-slate-100 align-top text-slate-700">
                    <td class="py-3 pr-4">${formatDateTime(row.createdAt)}</td>
                    <td class="py-3 pr-4">${row.module}</td>
                    <td class="py-3 pr-4">${row.entityType}<div class="text-xs text-slate-400">${row.entityId}</div></td>
                    <td class="py-3 pr-4">${row.fromStatus ?? 'null'} -> ${row.toStatus}</td>
                    <td class="py-3 pr-4">${row.actorId}<div class="text-xs text-slate-400">${row.actorType}</div></td>
                    <td class="py-3 pr-0">
                      <div>${row.reasonCode ?? 'n/a'}</div>
                      ${row.reason ? html`<div class="mt-1 text-xs text-slate-400">${row.reason}</div>` : ''}
                    </td>
                  </tr>
                  ${row.metadata ? html`
                    <tr class="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                      <td class="px-4 py-3" colspan="6"><pre class="overflow-x-auto whitespace-pre-wrap">${formatJson(row.metadata)}</pre></td>
                    </tr>
                  ` : ''}
                `)}
              </tbody>
            </table>
          </div>
          <div class="mt-4 flex items-center justify-between gap-4 text-sm text-slate-500">
            <button ?disabled=${this.statusHistoryData.summary.page <= 1} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${(event: Event) => this.handlePageClick(event, 'status-history', this.statusHistoryData!.summary.page - 1)}>Previous</button>
            <span>Page ${this.statusHistoryData.summary.page} of ${this.statusHistoryData.summary.totalPages}</span>
            <button ?disabled=${this.statusHistoryData.summary.page >= this.statusHistoryData.summary.totalPages} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${(event: Event) => this.handlePageClick(event, 'status-history', this.statusHistoryData!.summary.page + 1)}>Next</button>
          </div>
        </article>

        <div class="space-y-6">
          ${this.renderNamedCountList('By module', this.statusHistoryData.groups.byModule)}
          ${this.renderNamedCountList('By transition', this.statusHistoryData.groups.byTransition)}
          ${this.renderNamedCountList('Current statuses', this.statusHistoryData.groups.currentStatuses)}
        </div>
      </section>
    `;
  }

  render() {
    return html`
      <main class="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-6 py-8 text-slate-900">
        <section class="mx-auto max-w-7xl">
          <header class="flex flex-col gap-4 rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur md:flex-row md:items-end md:justify-between">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Audit module</p>
              <h1 class="mt-2 text-3xl font-semibold tracking-tight">Operational audit trails</h1>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Read immutable change history and lifecycle transitions without duplicating navigation in the header.
              </p>
              <p class="mt-3 text-sm text-slate-500">${this.status}</p>
              ${this.routeError ? html`<p class="mt-2 text-sm font-medium text-rose-600">${this.routeError}</p>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">${this.currentSection}</span>
              <button class="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700" @click=${this.handleRefreshClick}>Refresh</button>
            </div>
          </header>

          <section class="mt-6">
            ${this.currentSection === 'overview' ? this.renderOverview() : ''}
            ${this.currentSection === 'audit-log' ? this.renderAuditLog() : ''}
            ${this.currentSection === 'status-history' ? this.renderStatusHistory() : ''}
          </section>
        </section>
      </main>
    `;
  }
}

customElements.define('audit-web-desktop-home-page', AuditWebDesktopHomePage);
