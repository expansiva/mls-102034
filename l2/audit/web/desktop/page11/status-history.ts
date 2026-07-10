/// <mls fileReference="_102034_/l2/audit/web/desktop/page11/status-history.ts" enhancement="_102020_/l2/enhancementAura"/>

// Modernized standalone page for the audit "status-history" route (Opção A). No
// window.location branching: owns its filter/pagination state and reloads locally.

import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { LitElement } from 'lit';
import { loadAuditStatusHistory } from '/_102034_/l2/audit/web/shared/statusHistory.js';
import { formatDateTime, formatInteger, formatJson } from '/_102034_/l2/audit/web/shared/formatters.js';
import type { AuditStatusHistoryResponse } from '/_102034_/l2/audit/shared/contracts/status-history.js';

interface StatusHistoryFilters {
  module: string;
  entityType: string;
  entityId: string;
  actorId: string;
  fromStatus: string;
  toStatus: string;
  reasonCode: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: StatusHistoryFilters = {
  module: '', entityType: '', entityId: '', actorId: '', fromStatus: '', toStatus: '', reasonCode: '', from: '', to: '',
};

@customElement('audit--web--desktop--page11--status-history-102034')
export class AuditWebDesktopPage11StatusHistoryPage extends LitElement {

  static properties = {
    status: { state: true },
    routeError: { state: true },
    data: { state: true },
    page: { state: true },
    filters: { state: true },
  };

  status = 'Loading status history...';
  routeError?: string;
  declare data?: AuditStatusHistoryResponse;
  page = 1;
  filters: StatusHistoryFilters = { ...EMPTY_FILTERS };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.routeError = undefined;
    this.status = 'Loading status history...';
    try {
      const response = await loadAuditStatusHistory({ ...this.filters, page: this.page });
      if (!response.ok || !response.data) {
        throw new Error(response.error?.message ?? 'Could not load status history.');
      }
      this.data = response.data;
      this.status = `Updated ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (error) {
      this.routeError = error instanceof Error ? error.message : String(error);
      this.status = 'Load failed.';
    }
  }

  private handleFilterSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const next = { ...EMPTY_FILTERS };
    for (const [key, value] of formData.entries()) {
      if (key in next) (next as Record<string, string>)[key] = String(value);
    }
    this.filters = next;
    this.page = 1;
    void this.load();
  }

  private goToPage(page: number) {
    this.page = Math.max(1, page);
    void this.load();
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

  private card(title: string, value: string, detail: string) {
    return html`
      <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">${title}</p>
        <p class="mt-3 text-3xl font-semibold text-slate-900">${value}</p>
        <p class="mt-2 text-sm text-slate-500">${detail}</p>
      </section>
    `;
  }

  private renderBody() {
    const data = this.data;
    if (!data) return html``;
    const filters = data.filters;
    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${this.card('Transitions', formatInteger(data.summary.total), `Page ${data.summary.page} of ${data.summary.totalPages}`)}
        ${this.card('Entities', formatInteger(data.summary.uniqueEntities), 'Entities represented in current filter')}
        ${this.card('Transitions kinds', formatInteger(data.summary.uniqueTransitions), 'Unique from -> to combinations')}
        ${this.card('Modules', formatInteger(data.summary.uniqueModules), 'Modules represented in filtered result')}
      </section>

      <form class="mt-6 grid gap-3 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4" @submit=${(event: SubmitEvent) => this.handleFilterSubmit(event)}>
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
                  <th class="pb-3 pr-4">Time</th><th class="pb-3 pr-4">Module</th><th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Transition</th><th class="pb-3 pr-4">Actor</th><th class="pb-3 pr-0">Reason</th>
                </tr>
              </thead>
              <tbody>
                ${data.events.map((row) => html`
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
            <button ?disabled=${data.summary.page <= 1} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${() => this.goToPage(data.summary.page - 1)}>Previous</button>
            <span>Page ${data.summary.page} of ${data.summary.totalPages}</span>
            <button ?disabled=${data.summary.page >= data.summary.totalPages} class="rounded-full border border-slate-300 px-3 py-1 disabled:opacity-40" @click=${() => this.goToPage(data.summary.page + 1)}>Next</button>
          </div>
        </article>

        <div class="space-y-6">
          ${this.renderNamedCountList('By module', data.groups.byModule)}
          ${this.renderNamedCountList('By transition', data.groups.byTransition)}
          ${this.renderNamedCountList('Current statuses', data.groups.currentStatuses)}
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
              <h1 class="mt-2 text-3xl font-semibold tracking-tight">Status History</h1>
              <p class="mt-3 text-sm text-slate-500">${this.status}</p>
              ${this.routeError ? html`<p class="mt-2 text-sm font-medium text-rose-600">${this.routeError}</p>` : ''}
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">status-history</span>
          </header>
          <section class="mt-6">${this.renderBody()}</section>
        </section>
      </main>
    `;
  }
}
