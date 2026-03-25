/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/aside.ts" enhancement="_blank" />
import { LitElement, html } from 'lit';
import type { AuraBootConfig, AuraNavigationItem } from '/_102029_/l2/contracts/bootstrap.js';
import { beginExpectedNavigationLoad, runBlockingUiAction } from '/_102029_/l2/interactionRuntime.js';
import { closeAuraAside } from '/_102029_/l2/shellEvents.js';

function traceLazy(event: string, details?: Record<string, unknown>) {
  if (!window.isTraceLazy) {
    return;
  }
  console.log('[traceLazy][monitor-aside]', event, details ?? {});
}

export class MonitorWebDesktopAside extends LitElement {
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
    this.requestUpdate();
  };

  private isActive(item: AuraNavigationItem) {
    if (item.href === this.bootConfig?.basePath) {
      return (
        this.currentPath === item.href ||
        this.currentPath === `${item.href}/index.html` ||
        this.currentPath === `${item.href}/overview`
      );
    }

    return this.currentPath === item.href || this.currentPath.startsWith(`${item.href}/`);
  }

  private handleNavigate(event: Event) {
    const target = event.currentTarget as HTMLAnchorElement | null;
    const href = target?.getAttribute('href');
    if (!href || !href.startsWith('/')) {
      return;
    }

    event.preventDefault();
    const basePath = this.bootConfig?.basePath ?? '';
    const isCurrentModuleRoute = href === basePath || href.startsWith(`${basePath}/`);
    if (!isCurrentModuleRoute) {
      window.location.href = href;
      return;
    }

    const nextPath = new URL(href, window.location.origin).pathname;
    if (this.currentPath !== nextPath) {
      this.currentPath = nextPath;
      this.requestUpdate();
    }

    if (window.location.pathname !== href) {
      traceLazy('handleNavigate', {
        href,
      });
      const retry = () => this.navigateWithinModule(href);
      void runBlockingUiAction(
        async (signal) => {
          await this.navigateWithinModule(href, signal);
        },
        {
          clearContentWhileBusy: true,
          busyLabel: 'Carregando pagina...',
          errorTitle: 'Nao foi possivel carregar esta pagina',
          retry,
        },
      );
    }
    closeAuraAside();
  }

  private async navigateWithinModule(href: string, signal?: AbortSignal) {
    const pendingLoad = beginExpectedNavigationLoad(signal);
    traceLazy('navigateWithinModule.dispatch', {
      href,
    });
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await pendingLoad;
    traceLazy('navigateWithinModule.resolved', {
      href,
    });
  }

  render() {
    const navigation = this.bootConfig?.navigation ?? [];
    const moduleLinks = this.bootConfig?.moduleLinks ?? [];
    return html`
      <style>
        monitor-web-desktop-aside {
          display: block;
          height: 100%;
        }

        monitor-web-desktop-aside .aside {
          display: flex;
          flex-direction: column;
          gap: 20px;
          height: 100%;
          padding: 20px;
          background: linear-gradient(180deg, #102a43 0%, #1f4d78 100%);
          color: #f8fafc;
        }

        monitor-web-desktop-aside .badge {
          display: inline-flex;
          width: fit-content;
          border-radius: 999px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.12);
          font-size: 0.78rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        monitor-web-desktop-aside ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 10px;
        }

        monitor-web-desktop-aside .section {
          display: grid;
          gap: 10px;
        }

        monitor-web-desktop-aside .section-label {
          font-size: 0.76rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(248, 250, 252, 0.62);
        }

        monitor-web-desktop-aside li {
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }

        monitor-web-desktop-aside li.active {
          background: rgba(255, 255, 255, 0.2);
        }

        monitor-web-desktop-aside a {
          display: block;
          padding: 12px 14px;
          color: inherit;
          text-decoration: none;
        }

        monitor-web-desktop-aside strong {
          display: block;
        }

        monitor-web-desktop-aside small {
          display: block;
          margin-top: 4px;
          color: rgba(248, 250, 252, 0.72);
        }

        monitor-web-desktop-aside .caption {
          color: rgba(248, 250, 252, 0.72);
          font-size: 0.84rem;
          line-height: 1.5;
        }

        monitor-web-desktop-aside .module-name {
          margin-top: 12px;
        }

        monitor-web-desktop-aside .head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        monitor-web-desktop-aside .close {
          display: none;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 999px;
          border: 1px solid rgba(248, 250, 252, 0.18);
          background: rgba(255, 255, 255, 0.08);
          color: inherit;
          cursor: pointer;
        }

        @media (max-width: 768px) {
          monitor-web-desktop-aside .close.enabled {
            display: inline-flex;
          }
        }
      </style>
      <aside class="aside">
        <div class="head">
          <div>
            <div class="badge">Module Aside</div>
            <div class="module-name">${this.bootConfig?.moduleId ?? 'monitor'}</div>
            <div class="caption">This navigation belongs to the monitor module and can evolve without changing Aura.</div>
          </div>
          <button
            class="close ${this.bootConfig?.layout.asideMode.mobile !== 'inline' ? 'enabled' : ''}"
            type="button"
            aria-label="Close monitor navigation"
            @click=${() => closeAuraAside()}
          >
            ✕
          </button>
        </div>
        <div class="section">
          <div class="section-label">Pages</div>
          <ul>
            ${navigation.map((item) => html`
              <li class=${this.isActive(item) ? 'active' : ''}>
                <a href=${item.href} @click=${this.handleNavigate}>
                  <strong>${item.label}</strong>
                  ${item.description ? html`<small>${item.description}</small>` : null}
                </a>
              </li>
            `)}
          </ul>
        </div>
        ${moduleLinks.length > 0
          ? html`
              <div class="section">
                <div class="section-label">Other Modules</div>
                <ul>
                  ${moduleLinks.map((item) => html`
                    <li>
                      <a href=${item.href} @click=${this.handleNavigate}>
                        <strong>${item.label}</strong>
                        ${item.description ? html`<small>${item.description}</small>` : null}
                      </a>
                    </li>
                  `)}
                </ul>
              </div>
            `
          : null}
      </aside>
    `;
  }
}

customElements.define('monitor-web-desktop-aside', MonitorWebDesktopAside);
