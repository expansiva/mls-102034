/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/external/settings/persistence.ts" enhancement="_blank" />
import { externalSettingsDefinition } from '/_102034_/l1/server/layer_1_external/connections/external/externalSettingsStore.js';
import type { TableDefinition } from '/_102034_/l1/server/layer_1_external/persistence/contracts.js';

/** The vault. No retention: a release that changes another module must not rebuild this one. */
export const tableDefinitions: TableDefinition[] = [externalSettingsDefinition];
