/// <mls fileReference="_102034_/l2/monitor/web/routes/config.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';

// Read-only page: shows the composed workspace config.json as formatted JSON, so the
// runtime config (e.g. clientShell.regions.*.profiles used by mls.sites) can be inspected.
export class MonitorWebDesktopConfigPage extends LitElement {
  static properties = {
    status: { state: true },
    json: { state: true },
    busy: { state: true },
  };

  status = 'Loading config.json...';
  json = '';
  busy = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.loadConfig();
  }

  private async loadConfig() {
    this.busy = true;
    const res = await execBff<unknown>('monitor.config.load', {}, { mode: 'silent' });
    this.busy = false;
    if (!res.ok || res.data === undefined) {
      this.status = res.error?.message ?? 'Could not load config.json.';
      this.json = '';
      return;
    }
    this.json = JSON.stringify(res.data, null, 2);
    this.status = 'config.json (read-only)';
  }

  private async copyJson() {
    try {
      await navigator.clipboard.writeText(this.json);
      this.status = 'config.json copied to clipboard';
    } catch {
      this.status = 'copy failed (clipboard unavailable)';
    }
  }

  render() {
    return html`
      <section class="space-y-6">
        <header class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-slate-900">Config</h1>
            <p class="mt-1 text-sm text-slate-500">${this.status}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
              ?disabled=${this.busy || !this.json}
              @click=${() => this.copyJson()}
            >
              Copy
            </button>
            <button
              class="rounded-full bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200 disabled:opacity-50"
              ?disabled=${this.busy}
              @click=${() => this.loadConfig()}
            >
              Reload
            </button>
          </div>
        </header>
        <article class="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <pre class="max-h-[70vh] overflow-auto whitespace-pre p-6 font-mono text-xs leading-relaxed text-slate-800">${this.json}</pre>
        </article>
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-config-page', MonitorWebDesktopConfigPage);
