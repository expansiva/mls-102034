/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/header.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import type { AuraBootConfig } from '/_102029_/l2/contracts/bootstrap.js';
import { toggleAuraAside } from '/_102029_/l2/shellEvents.js';

function readMonitorSection(pathname: string) {
  if (pathname.startsWith('/monitor/architecture')) {
    return 'Architecture';
  }
  if (pathname.startsWith('/monitor/postgres')) {
    return 'Postgres';
  }
  if (pathname.startsWith('/monitor/dynamodb')) {
    return 'DynamoDB';
  }
  return 'Overview';
}

export class MonitorWebDesktopHeader extends LitElement {
  static properties = {
    bootConfig: { attribute: false },
    currentPath: { state: true },
  };

  declare bootConfig?: AuraBootConfig;
  currentPath = '/monitor';

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.currentPath = window.location.pathname;
    window.addEventListener('popstate', this.handleLocationChange);
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.handleLocationChange);
    super.disconnectedCallback();
  }

  private readonly handleLocationChange = () => {
    this.currentPath = window.location.pathname;
  };

  render() {
    const sectionLabel = readMonitorSection(this.currentPath);
    return html`
      <style>
        monitor-web-desktop-header {
          display: block;
        }

        monitor-web-desktop-header .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 18px 24px;
          border-bottom: 1px solid #d9e2ec;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(14px);
        }

        monitor-web-desktop-header .brand {
          display: grid;
          gap: 4px;
        }

        monitor-web-desktop-header .left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        monitor-web-desktop-header .eyebrow {
          font-size: 0.75rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #486581;
        }

        monitor-web-desktop-header .title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #102a43;
        }

        monitor-web-desktop-header .meta {
          color: #52606d;
          font-size: 0.88rem;
        }

        monitor-web-desktop-header .toggle {
          display: none;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          border-radius: 999px;
          border: 1px solid #d9e2ec;
          background: white;
          color: #102a43;
          font-size: 1.1rem;
          cursor: pointer;
        }

        @media (max-width: 768px) {
          monitor-web-desktop-header .toggle.enabled {
            display: inline-flex;
          }

          monitor-web-desktop-header .meta {
            display: none;
          }
        }
      </style>
      <header class="header">
        <div class="left">
          <button
            class="toggle ${this.bootConfig?.layout.asideMode.mobile !== 'inline' ? 'enabled' : ''}"
            type="button"
            aria-label="Open monitor navigation"
            @click=${() => toggleAuraAside()}
          >
            ☰
          </button>
          <div class="brand">
            <div class="eyebrow">Monitor Module</div>
            <div class="title">${this.bootConfig?.pageTitle ?? this.bootConfig?.moduleId ?? 'monitor'} · ${sectionLabel}</div>
          </div>
        </div>
        <div class="meta">
          ${this.bootConfig?.projectId ?? 'project'} · ${this.bootConfig?.device ?? 'device'} · ${this.bootConfig?.shellMode ?? 'shell'}
        </div>
      </header>
    `;
  }
}

customElements.define('monitor-web-desktop-header', MonitorWebDesktopHeader);
