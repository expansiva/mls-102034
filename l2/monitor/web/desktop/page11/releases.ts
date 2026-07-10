/// <mls fileReference="_102034_/l2/monitor/web/desktop/page11/releases.ts" enhancement="_102020_/l2/enhancementAura"/>

// Modernized standalone page for the monitor "releases" route. Releases is already a
// self-contained component; here it just gets a convention tag so the aura preview resolves it.

import { customElement } from 'lit/decorators.js';
import { MonitorWebDesktopReleasesPage } from '/_102034_/l2/monitor/web/routes/releases.js';

@customElement('monitor--web--desktop--page11--releases-102034')
export class MonitorReleasesPage extends MonitorWebDesktopReleasesPage {}
