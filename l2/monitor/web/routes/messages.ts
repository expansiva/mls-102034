/// <mls fileReference="_102034_/l2/monitor/web/routes/messages.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';
import type { MonitorMessagesStatusResponse } from '/_102034_/l2/monitor/shared/contracts/messages.js';
import type { MonitorLogApp, MonitorLogPage, MonitorLogPageInput, MonitorLogStream } from '/_102034_/l2/monitor/shared/contracts/logs.js';
import {
  applyMessagesLogsOlderPage,
  applyMessagesLogsPage,
  beginMessagesLogsLoadMore,
  beginMessagesLogsQuery,
  connectMessagesLogs,
  createMessagesLogsState,
  disconnectMessagesLogs,
  failMessagesLogsLoadMore,
  failMessagesLogsQuery,
  isCurrentMessagesLogs,
  markMessagesLogsSourceChanged,
  messagesLogsCanCopy,
  messagesLogsCanLoadMore,
  messagesLogsBody,
  messagesLogsCopyText,
  startAtLocalToIso,
  type MessagesLogsState,
} from '/_102034_/l2/monitor/web/routes/messagesLogsState.js';

function formatUptime(uptimeMs: number | null): string {
  if (uptimeMs == null || uptimeMs < 0) return '—';
  const seconds = Math.floor(uptimeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export class MonitorWebDesktopMessagesPage extends LitElement {
  static properties = {
    status: { state: true },
    busy: { state: true },
    payload: { state: true },
    logs: { state: true },
    draftStartAt: { state: true },
    draftText: { state: true },
    startAtError: { state: true },
    copyNotice: { state: true },
  };

  status = 'Loading collab-messages...';
  busy = false;
  payload: MonitorMessagesStatusResponse | null = null;
  logs: MessagesLogsState = createMessagesLogsState();
  draftStartAt = '';
  draftText = '';
  startAtError = '';
  copyNotice = '';

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.logs = connectMessagesLogs(this.logs);
    void this.reload();
  }

  disconnectedCallback() {
    this.logs = disconnectMessagesLogs(this.logs);
    super.disconnectedCallback();
  }

  private async reload() {
    this.logs = beginMessagesLogsQuery(this.logs, this.logs.query);
    const generation = this.logs.generation;
    await Promise.all([this.loadStatus(), this.fetchLogs(generation, null)]);
  }

  private async loadStatus() {
    this.busy = true;
    const res = await execBff<MonitorMessagesStatusResponse>('monitor.messages.status', {}, { mode: 'silent' });
    this.busy = false;
    if (!res.ok || !res.data) {
      this.status = res.error?.message ?? 'Could not load collab-messages status.';
      this.payload = null;
      return;
    }
    this.payload = res.data;
    this.status = res.data.local
      ? `local instance at ${res.data.target}`
      : `this VM proxies /msg to ${res.data.target}`;
  }

  private selectLogs(app: MonitorLogApp, stream: MonitorLogStream) {
    if (app === this.logs.query.app && stream === this.logs.query.stream) return;
    this.copyNotice = '';
    this.logs = beginMessagesLogsQuery(this.logs, { ...this.logs.query, app, stream });
    void this.fetchLogs(this.logs.generation, null);
  }

  private applyFilters() {
    const parsed = startAtLocalToIso(this.draftStartAt);
    if (!parsed.ok) {
      this.startAtError = parsed.error;
      return;
    }
    this.startAtError = '';
    this.copyNotice = '';
    this.logs = beginMessagesLogsQuery(this.logs, {
      ...this.logs.query,
      startAt: parsed.iso,
      text: this.draftText.trim(),
    });
    void this.fetchLogs(this.logs.generation, null);
  }

  private clearFilters() {
    this.draftStartAt = '';
    this.draftText = '';
    this.startAtError = '';
    this.copyNotice = '';
    this.logs = beginMessagesLogsQuery(this.logs, { ...this.logs.query, startAt: '', text: '' });
    void this.fetchLogs(this.logs.generation, null);
  }

  private onFilterKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.applyFilters();
  }

  private async loadOlder() {
    const started = beginMessagesLogsLoadMore(this.logs);
    if (started === this.logs || !started.pendingCursor) return;
    const cursor = started.pendingCursor;
    const generation = started.generation;
    this.logs = started;
    const before = this.logScroll();
    await this.fetchLogs(generation, cursor);
    await this.updateComplete;
    this.restoreLogScroll(before);
  }

  private logScroll(): { height: number; top: number } | null {
    const node = this.querySelector('[data-messages-log]');
    if (!(node instanceof HTMLPreElement)) return null;
    return { height: node.scrollHeight, top: node.scrollTop };
  }

  private restoreLogScroll(before: { height: number; top: number } | null) {
    if (!before) return;
    const node = this.querySelector('[data-messages-log]');
    if (!(node instanceof HTMLPreElement)) return;
    node.scrollTop = before.top + (node.scrollHeight - before.height);
  }

  private async copyLogs() {
    const text = messagesLogsCopyText(this.logs);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copyNotice = 'Copied';
    } catch {
      this.copyNotice = 'Copy failed (clipboard unavailable)';
    }
  }

  private async fetchLogs(generation: number, cursor: string | null) {
    const query = this.logs.query;
    const params: MonitorLogPageInput = { app: query.app, stream: query.stream };
    if (query.startAt) params.startAt = query.startAt;
    if (query.text) params.text = query.text;
    if (cursor) params.cursor = cursor;
    const res = await execBff<MonitorLogPage>('monitor.logs.page', params, { mode: 'silent' });
    if (!isCurrentMessagesLogs(this.logs, generation)) return;
    if (!res.ok || !res.data) {
      const message = res.error?.message ?? 'Could not load logs.';
      if (res.error?.code === 'LOG_SOURCE_CHANGED') {
        this.logs = markMessagesLogsSourceChanged(this.logs, generation);
        return;
      }
      this.logs = cursor
        ? failMessagesLogsLoadMore(this.logs, generation, message)
        : failMessagesLogsQuery(this.logs, generation, message);
      return;
    }
    this.logs = cursor
      ? applyMessagesLogsOlderPage(this.logs, generation, cursor, res.data)
      : applyMessagesLogsPage(this.logs, generation, res.data);
  }

  private storageError(payload: MonitorMessagesStatusResponse): string | undefined {
    return payload.health.storage?.error
      ?? payload.ready.error
      ?? payload.health.error;
  }

  render() {
    const payload = this.payload;
    const storage = payload?.health.storage;
    const healthOk = storage?.ok === true && payload?.health.reachable === true;
    const errorCode = payload ? this.storageError(payload) : undefined;
    return html`
      <section class="space-y-6">
        <header class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-slate-900">Collab Messages</h1>
            <p class="mt-1 text-sm text-slate-500">${this.status}</p>
          </div>
          <button
            class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
            ?disabled=${this.busy}
            @click=${() => { void this.reload(); }}
          >Refresh</button>
        </header>

        ${payload && !payload.local
          ? html`
              <article class="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                This VM does not host collab-messages. <code class="font-mono">${payload.target}</code> is the
                upstream; health and ready below are remote. pm2 and logs live on the host VM.
              </article>
            `
          : null}

        <div class="grid gap-6 lg:grid-cols-2">
          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Health</h2>
            <p class="mt-1 text-xs text-slate-500">${payload?.health.url ?? ''}</p>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              ${healthOk
                ? html`<span class="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">ok</span>`
                : html`<span class="rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-800">error</span>`}
              ${errorCode
                ? html`<span class="rounded-full bg-rose-600 px-3 py-1 text-sm font-semibold text-white">${errorCode}</span>`
                : null}
            </div>
            <p class="mt-3 text-sm text-slate-600">
              HTTP ${payload?.health.statusCode ?? '—'}
              · ready ${payload?.ready.status ?? '—'}
              (${payload?.ready.statusCode ?? '—'})
            </p>
          </article>

          <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-slate-900">Storage account</h2>
            <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-slate-500">accountId</dt><dd class="font-mono text-slate-900">${storage?.accountId ?? '—'}</dd>
              <dt class="text-slate-500">region</dt><dd class="font-mono text-slate-900">${storage?.dynamoRegion ?? '—'}</dd>
              <dt class="text-slate-500">bucket</dt><dd class="font-mono text-slate-900">${storage?.bucket ?? '—'}</dd>
              <dt class="text-slate-500">instanceId</dt><dd class="font-mono text-slate-900">${storage?.instanceId ?? '—'}</dd>
            </dl>
          </article>
        </div>

        ${payload?.local
          ? html`
              <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div class="px-6 py-4">
                  <h2 class="text-lg font-semibold text-slate-900">pm2</h2>
                  ${payload.pm2Error
                    ? html`<p class="mt-1 text-sm text-rose-700">${payload.pm2Error}</p>`
                    : null}
                </div>
                <table class="min-w-full text-left text-sm">
                  <thead class="bg-slate-50 text-slate-600">
                    <tr>
                      <th class="px-6 py-3 font-medium">Process</th>
                      <th class="px-6 py-3 font-medium">Instances</th>
                      <th class="px-6 py-3 font-medium">Status</th>
                      <th class="px-6 py-3 font-medium">Uptime</th>
                      <th class="px-6 py-3 font-medium">Restarts</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${payload.pm2.map((proc) => html`
                      <tr class="border-t border-slate-100">
                        <td class="px-6 py-3 font-medium text-slate-900">${proc.name}</td>
                        <td class="px-6 py-3 text-slate-600">${proc.instances}</td>
                        <td class="px-6 py-3">${proc.status}</td>
                        <td class="px-6 py-3 text-slate-600">${formatUptime(proc.uptimeMs)}</td>
                        <td class="px-6 py-3 text-slate-600">${proc.restarts}</td>
                      </tr>
                    `)}
                    ${payload.pm2.length === 0
                      ? html`<tr><td class="px-6 py-4 text-sm text-slate-500" colspan="5">No msg / msg-worker process reported.</td></tr>`
                      : null}
                  </tbody>
                </table>
              </article>

              <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div class="mb-3 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 class="text-lg font-semibold text-slate-900">pm2 logs</h2>
                    <p class="mt-1 text-xs text-slate-500">
                      ${this.logs.file || (this.logs.phase === 'loading' ? 'Loading log source...' : 'No log file')}
                      ${this.logs.entries.length > 0 ? ` · Showing ${this.logs.entries.length}` : ''}
                      ${this.logs.limited ? ' · Read limit reached' : ''}
                    </p>
                  </div>
                  <button
                    class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
                    ?disabled=${!messagesLogsCanCopy(this.logs)}
                    @click=${() => { void this.copyLogs(); }}
                  >Copy</button>
                </div>
                ${this.copyNotice
                  ? html`<p class="mb-3 text-sm text-slate-600">${this.copyNotice}</p>`
                  : null}
                <div class="mb-4 flex flex-wrap items-end gap-4 text-sm">
                  <label class="flex flex-col gap-1 text-slate-700">
                    Process
                    <select
                      class="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      .value=${this.logs.query.app}
                      @change=${(event: Event) => {
                        const value = (event.currentTarget as HTMLSelectElement).value;
                        if (value === 'msg' || value === 'msg-worker') this.selectLogs(value, this.logs.query.stream);
                      }}
                    >
                      <option value="msg" ?selected=${this.logs.query.app === 'msg'}>API</option>
                      <option value="msg-worker" ?selected=${this.logs.query.app === 'msg-worker'}>Worker</option>
                    </select>
                  </label>
                  <label class="flex flex-col gap-1 text-slate-700">
                    Output
                    <select
                      class="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      .value=${this.logs.query.stream}
                      @change=${(event: Event) => {
                        const value = (event.currentTarget as HTMLSelectElement).value;
                        if (value === 'out' || value === 'error') this.selectLogs(this.logs.query.app, value);
                      }}
                    >
                      <option value="out" ?selected=${this.logs.query.stream === 'out'}>Standard output</option>
                      <option value="error" ?selected=${this.logs.query.stream === 'error'}>Error output</option>
                    </select>
                  </label>
                  <label class="flex flex-col gap-1 text-slate-700">
                    Start at (UTC)
                    <input
                      class="rounded-xl border border-slate-200 px-3 py-2"
                      type="datetime-local"
                      step="1"
                      .value=${this.draftStartAt}
                      @input=${(event: Event) => { this.draftStartAt = (event.currentTarget as HTMLInputElement).value; }}
                      @keydown=${(event: KeyboardEvent) => { this.onFilterKeydown(event); }}
                    />
                    <span class="text-xs text-slate-500">UTC</span>
                    ${this.startAtError
                      ? html`<span class="text-xs text-rose-700">${this.startAtError}</span>`
                      : null}
                  </label>
                  <label class="flex flex-col gap-1 text-slate-700">
                    Message contains
                    <input
                      class="rounded-xl border border-slate-200 px-3 py-2"
                      type="text"
                      placeholder="[config_error]"
                      .value=${this.draftText}
                      @input=${(event: Event) => { this.draftText = (event.currentTarget as HTMLInputElement).value; }}
                      @keydown=${(event: KeyboardEvent) => { this.onFilterKeydown(event); }}
                    />
                  </label>
                  <button
                    class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
                    @click=${() => { this.applyFilters(); }}
                  >Apply filters</button>
                  <button
                    class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
                    @click=${() => { this.clearFilters(); }}
                  >Clear filters</button>
                </div>
                <button
                  class="mb-3 rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
                  ?disabled=${!messagesLogsCanLoadMore(this.logs)}
                  @click=${() => { void this.loadOlder(); }}
                >Load more</button>
                <p class="mb-3 text-xs text-slate-500">Loads earlier log entries.</p>
                ${this.logs.phase === 'source-changed'
                  ? html`<p class="mb-3 text-sm text-amber-800">${this.logs.errorMessage}</p>`
                  : null}
                ${this.logs.phase === 'error'
                  ? html`<p class="mb-3 text-sm text-rose-700">${this.logs.errorMessage}</p>`
                  : null}
                ${this.logs.phase !== 'error' && this.logs.phase !== 'source-changed' && this.logs.errorMessage
                  ? html`<p class="mb-3 text-sm text-rose-700">${this.logs.errorMessage}</p>`
                  : null}
                ${this.logs.phase === 'empty' && this.logs.hasMore
                  ? html`<p class="mb-3 text-sm text-slate-600">No matches in the section read.</p>`
                  : null}
                ${this.logs.phase === 'empty' && !this.logs.hasMore
                  ? html`<p class="mb-3 text-sm text-slate-600">No log entries.</p>`
                  : null}
                ${this.logs.phase === 'limited'
                  ? html`<p class="mb-3 text-sm text-slate-600">Search stopped at the read limit. Load more continues earlier history.</p>`
                  : null}
                ${this.logs.phase === 'result' && !this.logs.hasMore
                  ? html`<p class="mb-3 text-sm text-slate-600">End of log.</p>`
                  : null}
                <pre data-messages-log class="max-h-96 overflow-auto whitespace-pre rounded-2xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">${messagesLogsBody(this.logs)}</pre>
              </article>
            `
          : null}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-messages-page', MonitorWebDesktopMessagesPage);
