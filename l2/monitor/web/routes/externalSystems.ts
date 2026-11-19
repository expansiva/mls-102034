/// <mls fileReference="_102034_/l2/monitor/web/routes/externalSystems.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';

interface HostView {
  host?: string;
  fromSetting?: string;
  value?: string;
}

interface OperationView {
  operationId: string;
  direction: 'call' | 'serve';
  hook?: string;
}

interface SettingView {
  settingId: string;
  status: 'filled' | 'missing';
  secret: boolean;
}

interface CallLine {
  occurredAt: string;
  direction: 'out' | 'in';
  operationId: string;
  server: string;
  outcome: string;
  httpStatus: number | null;
  durationMs: number | null;
}

interface SystemView {
  systemId: string;
  title: string;
  hosts: HostView[];
  operations: OperationView[];
  settings: SettingView[];
  recent: CallLine[];
  writeFailureCount: number;
}

interface SystemsPayload {
  systems?: SystemView[];
  modules?: string[];
}

const text = {
  title: 'External systems',
  refresh: 'Refresh',
  loading: 'Loading external systems...',
  loadFailed: 'Could not load external systems.',
  pickModule: 'Choose a module',
  noModules: 'No module declares an external system.',
  noSystems: 'This module declares no external system.',
  hosts: 'Allowed hosts',
  hooks: 'Serve hooks',
  copy: 'Copy',
  copied: 'Hook copied.',
  copyFailed: 'Copy failed.',
  settings: 'Settings',
  filled: 'filled',
  missing: 'missing',
  secret: 'secret',
  save: 'Save',
  saved: 'Saved.',
  saveFailed: 'Could not save the setting.',
  newValue: 'New value',
  calls: 'Recent calls',
  when: 'When',
  direction: 'Direction',
  operation: 'Operation',
  server: 'Server',
  outcome: 'Outcome',
  code: 'Code',
  duration: 'Duration',
  noCalls: 'No calls recorded.',
  writeFailures: 'Record write failures',
  out: 'out',
  in: 'in',
} as const;

function moduleFromLocation(): string {
  return new URLSearchParams(window.location.search).get('module')?.trim() ?? '';
}

function hostLabel(host: HostView): string {
  if (host.host) return host.host;
  if (host.value) return `${host.fromSetting ?? ''} = ${host.value}`;
  return host.fromSetting ?? '';
}

export class MonitorWebDesktopExternalSystemsPage extends LitElement {
  static properties = {
    status: { state: true },
    busy: { state: true },
    moduleId: { state: true },
    modules: { state: true },
    systems: { state: true },
    drafts: { state: true },
  };

  status: string = text.loading;
  busy = false;
  moduleId = '';
  declare modules: string[];
  declare systems: SystemView[];
  declare drafts: Record<string, string>;

  constructor() {
    super();
    this.modules = [];
    this.systems = [];
    this.drafts = {};
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.moduleId = moduleFromLocation();
    void this.load();
  }

  private draftKey(systemId: string, settingId: string): string {
    return `${systemId}/${settingId}`;
  }

  private async load() {
    this.busy = true;
    const res = await execBff<SystemsPayload>(
      'monitor.externalSystems.list',
      this.moduleId === '' ? {} : { moduleId: this.moduleId },
      { mode: 'silent' },
    );
    this.busy = false;
    if (!res.ok || !res.data) {
      this.status = res.error?.message ?? text.loadFailed;
      this.modules = [];
      this.systems = [];
      return;
    }
    this.modules = res.data.modules ?? [];
    this.systems = res.data.systems ?? [];
    if (this.moduleId === '') {
      this.status = this.modules.length === 0 ? text.noModules : text.pickModule;
      return;
    }
    this.status = this.systems.length === 0 ? text.noSystems : `${this.systems.length} system(s)`;
  }

  private async copyHook(hook: string) {
    try {
      await navigator.clipboard.writeText(hook);
      this.status = text.copied;
    } catch (error) {
      console.error('[externalSystems] copy failed', error);
      this.status = text.copyFailed;
    }
  }

  private async saveSetting(systemId: string, settingId: string) {
    const key = this.draftKey(systemId, settingId);
    const value = this.drafts[key] ?? '';
    this.busy = true;
    const res = await execBff<{ ok: true }>(
      'monitor.externalSettings.set',
      { moduleId: this.moduleId, systemId, settingId, value },
      { mode: 'silent' },
    );
    this.busy = false;
    if (!res.ok) {
      this.status = res.error?.message ?? text.saveFailed;
      return;
    }
    this.drafts = { ...this.drafts, [key]: '' };
    this.status = text.saved;
    await this.load();
  }

  private renderModules() {
    return html`
      <ul class="space-y-2">
        ${this.modules.map((id) => html`
          <li>
            <a class="text-sm font-medium text-sky-700" href=${`/monitor/external-systems?module=${encodeURIComponent(id)}`}>${id}</a>
          </li>
        `)}
      </ul>
    `;
  }

  private renderSystem(system: SystemView) {
    const serves = system.operations.filter((item) => item.direction === 'serve' && item.hook);
    return html`
      <article class="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <header>
          <h2 class="text-lg font-semibold text-slate-900">${system.title}</h2>
          <p class="text-xs text-slate-500">${system.systemId} · ${text.writeFailures}: ${system.writeFailureCount}</p>
        </header>
        <section>
          <h3 class="mb-2 text-sm font-medium text-slate-700">${text.hosts}</h3>
          <ul class="text-sm text-slate-800">
            ${system.hosts.map((host) => html`<li>${hostLabel(host)}</li>`)}
          </ul>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-medium text-slate-700">${text.hooks}</h3>
          <ul class="space-y-2">
            ${serves.map((operation) => html`
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-medium">${operation.operationId}</span>
                <code class="text-xs text-slate-600">${operation.hook}</code>
                <button
                  class="rounded-full bg-slate-100 px-3 py-1 text-xs"
                  @click=${() => { void this.copyHook(operation.hook ?? ''); }}
                >${text.copy}</button>
              </li>
            `)}
          </ul>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-medium text-slate-700">${text.settings}</h3>
          <ul class="space-y-3">
            ${system.settings.map((setting) => {
              const key = this.draftKey(system.systemId, setting.settingId);
              return html`
                <li class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium">${setting.settingId}</span>
                  ${setting.secret ? html`<span class="text-xs text-slate-500">${text.secret}</span>` : null}
                  <span class="text-xs ${setting.status === 'filled' ? 'text-emerald-700' : 'text-amber-700'}">
                    ${setting.status === 'filled' ? text.filled : text.missing}
                  </span>
                  <input
                    class="rounded-full border border-slate-200 px-3 py-1 text-sm"
                    type=${setting.secret ? 'password' : 'text'}
                    placeholder=${text.newValue}
                    autocomplete="off"
                    .value=${this.drafts[key] ?? ''}
                    @input=${(event: Event) => {
                      const value = (event.target as HTMLInputElement).value;
                      this.drafts = { ...this.drafts, [key]: value };
                    }}
                  />
                  <button
                    class="rounded-full bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                    ?disabled=${this.busy}
                    @click=${() => { void this.saveSetting(system.systemId, setting.settingId); }}
                  >${text.save}</button>
                </li>
              `;
            })}
          </ul>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-medium text-slate-700">${text.calls}</h3>
          <table class="min-w-full text-left text-sm">
            <thead class="text-slate-600">
              <tr>
                <th class="py-2 pr-3 font-medium">${text.when}</th>
                <th class="py-2 pr-3 font-medium">${text.direction}</th>
                <th class="py-2 pr-3 font-medium">${text.operation}</th>
                <th class="py-2 pr-3 font-medium">${text.server}</th>
                <th class="py-2 pr-3 font-medium">${text.outcome}</th>
                <th class="py-2 pr-3 font-medium">${text.code}</th>
                <th class="py-2 pr-3 font-medium">${text.duration}</th>
              </tr>
            </thead>
            <tbody>
              ${system.recent.map((line) => html`
                <tr class="border-t border-slate-100">
                  <td class="py-2 pr-3">${line.occurredAt}</td>
                  <td class="py-2 pr-3">${line.direction === 'out' ? text.out : text.in}</td>
                  <td class="py-2 pr-3">${line.operationId}</td>
                  <td class="py-2 pr-3">${line.server}</td>
                  <td class="py-2 pr-3">${line.outcome}</td>
                  <td class="py-2 pr-3">${line.httpStatus ?? ''}</td>
                  <td class="py-2 pr-3">${line.durationMs ?? ''}</td>
                </tr>
              `)}
              ${system.recent.length === 0
                ? html`<tr><td class="py-2 text-slate-500" colspan="7">${text.noCalls}</td></tr>`
                : null}
            </tbody>
          </table>
        </section>
      </article>
    `;
  }

  render() {
    return html`
      <section class="space-y-6">
        <header class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-slate-900">${text.title}</h1>
            <p class="mt-1 text-sm text-slate-500">${this.status}</p>
          </div>
          <button class="rounded-full bg-slate-100 px-4 py-2 text-sm" @click=${() => { void this.load(); }}>${text.refresh}</button>
        </header>
        ${this.moduleId === '' ? this.renderModules() : this.systems.map((system) => this.renderSystem(system))}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-external-systems-page', MonitorWebDesktopExternalSystemsPage);
