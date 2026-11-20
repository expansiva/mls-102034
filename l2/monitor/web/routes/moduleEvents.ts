/// <mls fileReference="_102034_/l2/monitor/web/routes/moduleEvents.ts" enhancement="_102029_/l2/enhancementLit" />
import { html } from 'lit';
import { execBff } from '/_102029_/l2/bffClient.js';
import { CollabLitElement, getMessageKey } from '/_102029_/l2/collabLitElement.js';
import {
  moduleEventsCatalog,
  moduleEventsCount,
  moduleEventsErrorText,
  moduleEventsPageText,
} from '/_102034_/l2/monitor/web/routes/moduleEventsText.js';

function pageText() {
  return moduleEventsPageText(getMessageKey(moduleEventsCatalog()));
}

interface EventSummary {
  event: string;
  subscribers: string[];
  published24h: number;
  published7d: number;
  delivered: number;
  pending: number;
  failed: number;
}

interface EventFailure {
  event: string;
  consumerModule: string;
  attempts: number;
  reason: string;
  publishedAt: string;
}

interface EventsPayload {
  events?: EventSummary[];
  failures?: EventFailure[];
}

function moduleFromLocation(): string {
  return new URLSearchParams(window.location.search).get('module')?.trim() ?? '';
}

export class MonitorWebDesktopModuleEventsPage extends CollabLitElement {
  static properties = {
    status: { state: true },
    busy: { state: true },
    moduleId: { state: true },
    events: { state: true },
    failures: { state: true },
  };

  status = '';
  busy = false;
  moduleId = '';
  declare events: EventSummary[];
  declare failures: EventFailure[];

  constructor() {
    super();
    this.status = pageText().loading;
    this.events = [];
    this.failures = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.moduleId = moduleFromLocation();
    void this.load();
  }

  private async load() {
    const text = pageText();
    this.busy = true;
    const res = await execBff<EventsPayload>(
      'monitor.moduleEvents.list',
      this.moduleId === '' ? {} : { module: this.moduleId },
      { mode: 'silent' },
    );
    this.busy = false;
    if (!res.ok || !res.data) {
      this.status = moduleEventsErrorText(res.error?.code, text, text.loadFailed);
      this.events = [];
      this.failures = [];
      return;
    }
    this.events = res.data.events ?? [];
    this.failures = res.data.failures ?? [];
    const scope = this.moduleId === '' ? '' : ` ${text.filtered} ${this.moduleId}.`;
    this.status = this.events.length === 0 ? text.empty : `${moduleEventsCount(text, this.events.length)}${scope}`;
  }

  private renderEvents() {
    const text = pageText();
    return html`
      <section>
        <h2>${text.events}</h2>
        <table>
          <thead>
            <tr>
              <th>${text.event}</th>
              <th>${text.subscribers}</th>
              <th>${text.published24h}</th>
              <th>${text.published7d}</th>
              <th>${text.delivered}</th>
              <th>${text.pending}</th>
              <th>${text.failed}</th>
            </tr>
          </thead>
          <tbody>
            ${this.events.map((row) => html`
              <tr>
                <td>${row.event}</td>
                <td>${row.subscribers.join(', ')}</td>
                <td>${row.published24h}</td>
                <td>${row.published7d}</td>
                <td>${row.delivered}</td>
                <td>${row.pending}</td>
                <td>${row.failed}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderFailures() {
    const text = pageText();
    return html`
      <section>
        <h2>${text.failures}</h2>
        <table>
          <thead>
            <tr>
              <th>${text.when}</th>
              <th>${text.event}</th>
              <th>${text.consumer}</th>
              <th>${text.attempts}</th>
              <th>${text.reason}</th>
            </tr>
          </thead>
          <tbody>
            ${this.failures.map((row) => html`
              <tr>
                <td>${row.publishedAt}</td>
                <td>${row.event}</td>
                <td>${row.consumerModule}</td>
                <td>${row.attempts}</td>
                <td>${row.reason}</td>
              </tr>
            `)}
            ${this.failures.length === 0
              ? html`<tr><td colspan="5">${text.noFailures}</td></tr>`
              : null}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    const text = pageText();
    return html`
      <section class="module-events">
        <header>
          <div>
            <h1>${text.title}</h1>
            <p>${this.status}</p>
          </div>
          <button ?disabled=${this.busy} @click=${() => { void this.load(); }}>${text.refresh}</button>
        </header>
        ${this.renderEvents()}
        ${this.renderFailures()}
      </section>
    `;
  }
}

customElements.define('monitor-web-desktop-module-events-page', MonitorWebDesktopModuleEventsPage);
