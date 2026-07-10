/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/abend.ts" enhancement="_102020_/l2/enhancementAura"/>

// Modernized standalone page for the monitor "abend" route (Opção A). Reuses all of the
// monitor home logic by extending it and fixing the initial route (no shell/URL needed).

import { customElement } from 'lit/decorators.js';
import { MonitorWebDesktopHomePage } from '/_102034_/l2/monitor/web/desktop/page11/home.js';

@customElement('monitor--web--desktop--page11--abend-102034')
export class MonitorAbendPage extends MonitorWebDesktopHomePage {
  connectedCallback() {
    if (!this.getAttribute('data-route')) this.setAttribute('data-route', '/monitor/abend');
    super.connectedCallback();
  }
}
