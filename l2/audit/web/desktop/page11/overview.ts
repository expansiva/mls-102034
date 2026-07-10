/// <mls fileReference="_102034_/l2/audit/web/desktop/page11/overview.ts" enhancement="_102020_/l2/enhancementAura"/>

// Pilot page (Opção A modernization): a standalone client-pattern page for the audit
// "overview" route, rendered by the Studio aura preview. Unlike the runtime SPA (home.ts),
// this page does NOT branch on window.location — it renders only the overview section and
// loads its own data on connect.

import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { LitElement } from 'lit';
import { loadAuditHome } from '/_102034_/l2/audit/web/shared/home.js';
import { formatDateTime, formatInteger } from '/_102034_/l2/audit/web/shared/formatters.js';
import type { AuditHomeResponse } from '/_102034_/l2/audit/shared/contracts/home.js';

@customElement('audit--web--desktop--page11--overview-102034')
export class AuditWebDesktopPage11OverviewPage extends LitElement {

  static properties = {
    status: { state: true },
    routeError: { state: true },
    homeData: { state: true },
  };

  status = 'Loading overview...';
  routeError?: string;
  declare homeData?: AuditHomeResponse;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.routeError = undefined;
    this.status = 'Loading overview...';
    try {
      const response = await loadAuditHome({});
      if (!response.ok || !response.data) {
        throw new Error(response.error?.message ?? 'Could not load audit overview.');
      }
      this.homeData = response.data;
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

  private renderOverview() {
    const data = this.homeData;
    if (!data) return html``;
    return html`
      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${this.card('Audit Log', formatInteger(data.summary.auditLog.total), `${formatInteger(data.summary.auditLog.last24h)} in the last 24h`)}
        ${this.card('Status History', formatInteger(data.summary.statusHistory.total), `${formatInteger(data.summary.statusHistory.last24h)} in the last 24h`)}
        ${this.card('Modules', formatInteger(data.distribution.byModule.length), 'Top active modules across both trails')}
        ${this.card('Entity Types', formatInteger(data.distribution.byEntityType.length), 'Top tracked entities across both trails')}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-3">
        ${this.renderNamedCountList('By module', data.distribution.byModule)}
        ${this.renderNamedCountList('By entity type', data.distribution.byEntityType)}
        ${this.renderNamedCountList('By actor', data.distribution.byActorId)}
      </section>

      <section class="mt-6 grid gap-6 xl:grid-cols-2">
        <article class="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent audit log events</p>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr><th class="pb-3 pr-4">Time</th><th class="pb-3 pr-4">Module</th><th class="pb-3 pr-4">Entity</th><th class="pb-3 pr-4">Action</th></tr>
              </thead>
              <tbody>
                ${data.recentEvents.auditLog.map((row) => html`
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
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent status transitions</p>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="text-slate-500">
                <tr><th class="pb-3 pr-4">Time</th><th class="pb-3 pr-4">Module</th><th class="pb-3 pr-4">Entity</th><th class="pb-3 pr-4">Transition</th></tr>
              </thead>
              <tbody>
                ${data.recentEvents.statusHistory.map((row) => html`
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

  render() {
    return html`
      <main class="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-6 py-8 text-slate-900">
        <section class="mx-auto max-w-7xl">
          <header class="flex flex-col gap-4 rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur md:flex-row md:items-end md:justify-between">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Audit module</p>
              <h1 class="mt-2 text-3xl font-semibold tracking-tight">Overview</h1>
              <p class="mt-3 text-sm text-slate-500">${this.status}</p>
              ${this.routeError ? html`<p class="mt-2 text-sm font-medium text-rose-600">${this.routeError}</p>` : ''}
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-600">overview</span>
          </header>

          <section class="mt-6">${this.renderOverview()}</section>
        </section>
      </main>
    `;
  }
}
