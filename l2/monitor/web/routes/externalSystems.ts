/// <mls fileReference="_102034_/l2/monitor/web/routes/externalSystems.ts" enhancement="_102029_/l2/enhancementLit" />
import { html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';
import { CollabLitElement, getMessageKey } from '/_102029_/l2/collabLitElement.js';
import {
  externalSystemsCatalog,
  externalSystemsCount,
  externalSystemsErrorText,
  externalSystemsPageText,
} from '/_102034_/l2/monitor/web/routes/externalSystemsText.js';

function pageText() {
  return externalSystemsPageText(getMessageKey(externalSystemsCatalog()));
}

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

function moduleFromLocation(): string {
  return new URLSearchParams(window.location.search).get('module')?.trim() ?? '';
}

function hostLabel(host: HostView): string {
  if (host.host) return host.host;
  if (host.value) return `${host.fromSetting ?? ''} = ${host.value}`;
  return host.fromSetting ?? '';
}

export class MonitorWebDesktopExternalSystemsPage extends CollabLitElement {
  static properties = {
    status: { state: true },
    busy: { state: true },
    moduleId: { state: true },
    modules: { state: true },
    systems: { state: true },
    drafts: { state: true },
  };

  status = '';
  busy = false;
  moduleId = '';
  declare modules: string[];
  declare systems: SystemView[];
  declare drafts: Record<string, string>;

  constructor() {
    super();
    this.status = pageText().loading;
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
    const text = pageText();
    this.busy = true;
    const res = await execBff<SystemsPayload>(
      'monitor.externalSystems.list',
      this.moduleId === '' ? {} : { moduleId: this.moduleId },
      { mode: 'silent' },
    );
    this.busy = false;
    if (!res.ok || !res.data) {
      this.status = externalSystemsErrorText(res.error?.code, text, text.loadFailed);
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
    this.status = this.systems.length === 0 ? text.noSystems : externalSystemsCount(text, this.systems.length);
  }

  private async copyHook(hook: string) {
    const text = pageText();
    try {
      await navigator.clipboard.writeText(hook);
      this.status = text.copied;
    } catch (error) {
      console.error('[externalSystems] copy failed', error);
      this.status = text.copyFailed;
    }
  }

  private async saveSetting(systemId: string, settingId: string) {
    const text = pageText();
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
      this.status = externalSystemsErrorText(res.error?.code, text, text.saveFailed);
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
            <a class="link text-sm font-medium" href=${`/monitor/external-systems?module=${encodeURIComponent(id)}`}>${id}</a>
          </li>
        `)}
      </ul>
    `;
  }

  private renderSystem(system: SystemView) {
    const text = pageText();
    const serves = system.operations.filter((item) => item.direction === 'serve' && item.hook);
    return html`
      <article class="card space-y-4 rounded-3xl p-6 shadow-sm">
        <header>
          <h2 class="text-lg font-semibold">${system.title}</h2>
          <p class="muted text-xs">${system.systemId} · ${text.writeFailures}: ${system.writeFailureCount}</p>
        </header>
        <section>
          <h3 class="heading mb-2 text-sm font-medium">${text.hosts}</h3>
          <ul class="body text-sm">
            ${system.hosts.map((host) => html`<li>${hostLabel(host)}</li>`)}
          </ul>
        </section>
        <section>
          <h3 class="heading mb-2 text-sm font-medium">${text.hooks}</h3>
          <ul class="space-y-2">
            ${serves.map((operation) => html`
              <li class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-medium">${operation.operationId}</span>
                <code class="code text-xs">${operation.hook}</code>
                <button
                  class="chip rounded-full px-3 py-1 text-xs"
                  @click=${() => { void this.copyHook(operation.hook ?? ''); }}
                >${text.copy}</button>
              </li>
            `)}
          </ul>
        </section>
        <section>
          <h3 class="heading mb-2 text-sm font-medium">${text.settings}</h3>
          <ul class="space-y-3">
            ${system.settings.map((setting) => {
              const key = this.draftKey(system.systemId, setting.settingId);
              return html`
                <li class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium">${setting.settingId}</span>
                  ${setting.secret ? html`<span class="muted text-xs">${text.secret}</span>` : null}
                  <span class="text-xs ${setting.status === 'filled' ? 'ok' : 'warn'}">
                    ${setting.status === 'filled' ? text.filled : text.missing}
                  </span>
                  <input
                    class="rounded-full px-3 py-1 text-sm"
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
                    class="primary rounded-full px-3 py-1 text-xs disabled:opacity-50"
                    ?disabled=${this.busy}
                    @click=${() => { void this.saveSetting(system.systemId, setting.settingId); }}
                  >${text.save}</button>
                </li>
              `;
            })}
          </ul>
        </section>
        <section>
          <h3 class="heading mb-2 text-sm font-medium">${text.calls}</h3>
          <table class="min-w-full text-left text-sm">
            <thead class="muted">
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
                <tr class="row">
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
                ? html`<tr><td class="muted py-2" colspan="7">${text.noCalls}</td></tr>`
                : null}
            </tbody>
          </table>
        </section>
      </article>
    `;
  }

  render() {
    const text = pageText();
    return html`
      <section class="space-y-6">
        <header class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold">${text.title}</h1>
            <p class="muted mt-1 text-sm">${this.status}</p>
          </div>
          <button class="chip rounded-full px-4 py-2 text-sm" @click=${() => { void this.load(); }}>${text.refresh}</button>
        </header>
        ${this.moduleId === '' ? this.renderModules() : this.systems.map((system) => this.renderSystem(system))}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-external-systems-page', MonitorWebDesktopExternalSystemsPage);
