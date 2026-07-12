/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/operations.ts" enhancement="_102020_/l2/enhancementAura"/>
import { customElement } from 'lit/decorators.js';
import { MonitorWebDesktopHomePage } from '/_102034_/l2/monitor/web/desktop/page11/home.js';

@customElement('monitor--web--desktop--page11--operations-102034')
export class MonitorOperationsPage extends MonitorWebDesktopHomePage {
  connectedCallback() {
    if (!this.getAttribute('data-route')) this.setAttribute('data-route', '/monitor/operacao');
    super.connectedCallback();
  }
}
