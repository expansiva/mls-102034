/// <mls fileReference="_102034_/l2/monitor/web/routes/messages.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';
import type { MonitorMessagesStatusResponse } from '/_102034_/l2/monitor/shared/contracts/messages.js';

interface LogsTail {
  app: string;
  file: string;
  stream: 'out' | 'error';
  updatedAt: string | null;
  lines: string[];
}

type MsgLogApp = 'msg' | 'msg-worker';

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
    logApp: { state: true },
    logStream: { state: true },
    logFile: { state: true },
    logLines: { state: true },
  };

  status = 'Loading collab-messages...';
  busy = false;
  payload: MonitorMessagesStatusResponse | null = null;
  logApp: MsgLogApp = 'msg';
  logStream: 'out' | 'error' = 'error';
  logFile = '';
  declare logLines: string[];

  constructor() {
    super();
    this.logLines = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.reload();
  }

  private async reload() {
    await Promise.all([this.loadStatus(), this.loadLogs()]);
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

  private async loadLogs(app: MsgLogApp = this.logApp, stream: 'out' | 'error' = this.logStream) {
    this.logApp = app;
    this.logStream = stream;
    const res = await execBff<LogsTail>('monitor.logs.tail', { app, stream, lines: 200 }, { mode: 'silent' });
    if (!res.ok || !res.data) {
      this.logFile = '';
      this.logLines = [res.error?.message ?? 'Could not load logs.'];
      return;
    }
    this.logFile = res.data.file;
    this.logLines = res.data.lines;
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
                <div class="mb-3 flex items-center justify-between gap-4">
                  <div>
                    <h2 class="text-lg font-semibold text-slate-900">pm2 logs</h2>
                    <p class="mt-1 text-xs text-slate-500">${this.logFile || 'Loading log source...'}</p>
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-2 text-xs">
                    <button class="rounded-full px-3 py-1 ${this.logApp === 'msg' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs('msg', this.logStream); }}>api</button>
                    <button class="rounded-full px-3 py-1 ${this.logApp === 'msg-worker' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs('msg-worker', this.logStream); }}>worker</button>
                    <button class="rounded-full px-3 py-1 ${this.logStream === 'out' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs(this.logApp, 'out'); }}>stdout</button>
                    <button class="rounded-full px-3 py-1 ${this.logStream === 'error' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs(this.logApp, 'error'); }}>stderr</button>
                  </div>
                </div>
                <pre class="max-h-96 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">${this.logLines.join('\n')}</pre>
              </article>
            `
          : null}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-messages-page', MonitorWebDesktopMessagesPage);
