/// <mls fileReference="_102034_/l2/audit/web/desktop/page11/audit-log.ts" enhancement="_102020_/l2/enhancementAura"/>

// Modernized standalone page for the audit "audit-log" route (Opção A). No window.location
// branching: it owns its filter/pagination state and reloads data locally.

import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { LitElement } from 'lit';
import { loadAuditLog } from '/_102034_/l2/audit/web/shared/auditLog.js';
import { loadAuditLogDetails } from '/_102034_/l2/audit/web/shared/auditLogDetails.js';
import { formatDateTime, formatInteger, formatJson } from '/_102034_/l2/audit/web/shared/formatters.js';
import type { AuditLogDetailsResponse, AuditLogResponse } from '/_102034_/l2/audit/shared/contracts/audit-log.js';

interface AuditLogFilters {
  module: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorType: string;
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditLogFilters = {
  module: '', entityType: '', entityId: '', actorId: '', actorType: '', action: '', from: '', to: '',
};

@customElement('audit--web--desktop--page11--audit-log-102034')
export class AuditWebDesktopPage11AuditLogPage extends LitElement {

  static properties = {
    status: { state: true },
    routeError: { state: true },
    data: { state: true },
    details: { state: true },
    page: { state: true },
    filters: { state: true },
  };

  status = 'Loading audit log...';
  routeError?: string;
  declare data?: AuditLogResponse;
  declare details?: AuditLogDetailsResponse;
  page = 1;
  filters: AuditLogFilters = { ...EMPTY_FILTERS };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.routeError = undefined;
    this.status = 'Loading audit log...';
    this.details = undefined;
    try {
      const response = await loadAuditLog({ ...this.filters, page: this.page });
      if (!response.ok || !response.data) {
        throw new Error(response.error?.message ?? 'Could not load audit log.');
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

  private async loadDiff(id: string) {
    this.status = 'Loading remote diff...';
    try {
      const response = await loadAuditLogDetails({ id });
      if (!response.ok) {
        throw new Error(response.error?.message ?? 'Could not load audit details.');
      }
      this.details = response.data ?? undefined;
      this.status = `Updated ${new Date().toLocaleTimeString('pt-BR')}`;
    } catch (error) {
      this.routeError = error instanceof Error ? error.message : String(error);
      this.status = 'Load failed.';
    }
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

  private renderBody() {
    const data = this.data;
    if (!data) return html``;
    const filters = data.filters;
    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${this.card('Events', formatInteger(data.summary.total), `Page ${data.summary.page} of ${data.summary.totalPages}`)}
        ${this.card('Updates', formatInteger(data.summary.updateCount), `${formatInteger(data.summary.createCount)} creates in current filter`)}
        ${this.card('Actors', formatInteger(data.summary.uniqueActors), 'Unique actors in filtered result')}
        ${this.card('Modules', formatInteger(data.summary.uniqueModules), 'Modules represented in filtered result')}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-3">
        ${this.renderNamedCountList('By module', data.groups.byModule)}
        ${this.renderNamedCountList('By routine', data.groups.byRoutine)}
        ${this.renderNamedCountList('By action', data.groups.byAction)}
      </section>

      <form class="mt-6 grid gap-3 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2 xl:grid-cols-4" @submit=${(event: SubmitEvent) => this.handleFilterSubmit(event)}>
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
                  <th class="pb-3 pr-4">Time</th><th class="pb-3 pr-4">Module</th><th class="pb-3 pr-4">Entity</th>
                  <th class="pb-3 pr-4">Action</th><th class="pb-3 pr-4">Actor</th><th class="pb-3 pr-4">Routine</th><th class="pb-3 pr-0">Detail</th>
                </tr>
              </thead>
              <tbody>
                ${data.events.map((row) => html`
                  <tr class="border-t border-slate-100 align-top text-slate-700">
                    <td class="py-3 pr-4">${formatDateTime(row.createdAt)}</td>
                    <td class="py-3 pr-4">${row.module}</td>
                    <td class="py-3 pr-4">${row.entityType}<div class="text-xs text-slate-400">${row.entityId}</div></td>
                    <td class="py-3 pr-4">${row.action}</td>
                    <td class="py-3 pr-4">${row.actorId}<div class="text-xs text-slate-400">${row.actorType}</div></td>
                    <td class="py-3 pr-4">${row.routine}</td>
                    <td class="py-3 pr-0">
                      ${row.hasRemoteDiff
                        ? html`<button class="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:border-slate-500" @click=${() => this.loadDiff(row.id)}>View diff</button>`
                        : html`<span class="text-xs text-slate-400">n/a</span>`}
                    </td>
                  </tr>
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

        <aside class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm xl:sticky xl:top-6 xl:self-start">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Remote diff</p>
              <h3 class="mt-2 text-lg font-semibold text-slate-900">Selected change</h3>
            </div>
            ${this.details?.event
              ? html`<span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">loaded</span>`
              : html`<span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">waiting</span>`}
          </div>
          ${this.details?.event ? html`
            <div class="mt-4 rounded-3xl bg-slate-50 p-4 text-sm text-slate-600">
              <div class="flex items-center justify-between gap-4">
                <strong class="text-slate-900">${this.details.event.entityType}</strong>
                <span>${this.details.event.action}</span>
              </div>
              <p class="mt-2 break-all text-xs text-slate-500">${this.details.event.entityId}</p>
              <p class="mt-2 text-xs text-slate-500">${formatDateTime(this.details.event.createdAt)}</p>
            </div>
            <pre class="mt-4 max-h-[70vh] overflow-auto rounded-3xl bg-slate-950 p-5 text-xs leading-6 text-slate-100">${formatJson(this.details.event.diff)}</pre>
          ` : html`
            <div class="mt-4 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm leading-6 text-slate-500">
              Select an update row and click "View diff".
            </div>
          `}
        </aside>
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
              <h1 class="mt-2 text-3xl font-semibold tracking-tight">Audit Log</h1>
              <p class="mt-3 text-sm text-slate-500">${this.status}</p>
              ${this.routeError ? html`<p class="mt-2 text-sm font-medium text-rose-600">${this.routeError}</p>` : ''}
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">audit-log</span>
          </header>
          <section class="mt-6">${this.renderBody()}</section>
        </section>
      </main>
    `;
  }
}
