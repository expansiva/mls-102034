/// <mls fileReference="_102034_/l2/monitor/web/routes/releases.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';

interface ReleaseItem {
  id: string;
  active: boolean;
  createdAt: string;
}
interface ReleasesList {
  active: string | null;
  releases: ReleaseItem[];
}
interface LogsTail {
  file: string;
  stream: 'out' | 'error';
  lines: string[];
}

// Releases page: list releases, activate (deploy/rollback) and view pm2 logs.
//
// ADMIN ONLY view. The underlying BFF routines (monitor.releases.*, monitor.logs.tail)
// must enforce an admin check once authentication exists — see releaseHandlers.ts.
export class MonitorWebDesktopReleasesPage extends LitElement {
  static properties = {
    status: { state: true },
    busy: { state: true },
    active: { state: true },
    releases: { state: true },
    logStream: { state: true },
    logLines: { state: true },
  };

  status = 'Loading releases...';
  busy = false;
  active: string | null = null;
  declare releases: ReleaseItem[];
  logStream: 'out' | 'error' = 'out';
  declare logLines: string[];

  constructor() {
    super();
    this.releases = [];
    this.logLines = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.loadReleases();
    void this.loadLogs();
  }

  private async loadReleases() {
    const res = await execBff<ReleasesList>('monitor.releases.list', {}, { mode: 'silent' });
    if (!res.ok || !res.data) {
      this.status = res.error?.message ?? 'Could not load releases.';
      return;
    }
    this.active = res.data.active;
    this.releases = res.data.releases;
    this.status = `${this.releases.length} release(s) · active ${this.active ?? 'none'}`;
  }

  private async loadLogs(stream: 'out' | 'error' = this.logStream) {
    this.logStream = stream;
    const res = await execBff<LogsTail>('monitor.logs.tail', { stream, lines: 200 }, { mode: 'silent' });
    this.logLines = res.ok && res.data ? res.data.lines : [res.error?.message ?? 'Could not load logs.'];
  }

  private async activate(releaseId: string) {
    if (this.busy) {
      return;
    }
    if (!window.confirm(`Activate release ${releaseId}? The runtime will reload.`)) {
      return;
    }
    this.busy = true;
    this.status = `Activating ${releaseId}...`;
    const res = await execBff('monitor.releases.activate', { releaseId }, { mode: 'silent' });
    this.busy = false;
    if (!res.ok) {
      this.status = res.error?.message ?? 'Could not activate release.';
      return;
    }
    this.status = `Activated ${releaseId} — reloading runtime...`;
    // pm2 reloads asynchronously; refresh shortly after.
    window.setTimeout(() => {
      void this.loadReleases();
      void this.loadLogs();
    }, 2500);
  }

  render() {
    return html`
      <section class="space-y-6">
        <header class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-slate-900">Releases</h1>
            <p class="mt-1 text-sm text-slate-500">${this.status}</p>
          </div>
          <button class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200" @click=${() => { void this.loadReleases(); }}>Refresh</button>
        </header>

        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-600">
              <tr>
                <th class="px-6 py-3 font-medium">Release</th>
                <th class="px-6 py-3 font-medium">Created</th>
                <th class="px-6 py-3 font-medium">Status</th>
                <th class="px-6 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              ${this.releases.map((r) => html`
                <tr class="border-t border-slate-100">
                  <td class="px-6 py-3 font-medium text-slate-900">${r.id}</td>
                  <td class="px-6 py-3 text-slate-600">${new Date(r.createdAt).toLocaleString('pt-BR')}</td>
                  <td class="px-6 py-3">
                    ${r.active
                      ? html`<span class="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">active</span>`
                      : html`<span class="text-xs text-slate-400">—</span>`}
                  </td>
                  <td class="px-6 py-3">
                    ${r.active
                      ? html`<span class="text-xs text-slate-400">current</span>`
                      : html`<button
                          class="rounded-full bg-aura-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          ?disabled=${this.busy}
                          @click=${() => this.activate(r.id)}
                        >activate</button>`}
                  </td>
                </tr>
              `)}
              ${this.releases.length === 0
                ? html`<tr><td class="px-6 py-4 text-sm text-slate-500" colspan="4">No releases found.</td></tr>`
                : null}
            </tbody>
          </table>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-4">
            <h2 class="text-lg font-semibold text-slate-900">pm2 logs</h2>
            <div class="flex gap-2 text-xs">
              <button class="rounded-full px-3 py-1 ${this.logStream === 'out' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs('out'); }}>stdout</button>
              <button class="rounded-full px-3 py-1 ${this.logStream === 'error' ? 'bg-aura-blue text-white' : 'bg-slate-100 text-slate-700'}" @click=${() => { void this.loadLogs('error'); }}>stderr</button>
            </div>
          </div>
          <pre class="max-h-96 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">${this.logLines.join('\n')}</pre>
        </article>
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-releases-page', MonitorWebDesktopReleasesPage);
