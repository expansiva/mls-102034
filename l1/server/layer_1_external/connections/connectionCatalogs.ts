import cm from '/_102034_/l1/server/layer_1_external/connections/catalogs/cm.js';
import platform from '/_102034_/l1/server/layer_1_external/connections/catalogs/platform.js';
import type { ConnectionCatalog } from '/_102034_/l1/server/layer_1_external/connections/catalogs/types.js';

/** The connections of the platform are a closed list (conexoes.md, decision 5): each one is here, under its own id. */
const PLATFORM_CATALOGS: Readonly<Record<string, ConnectionCatalog>> = { cm, platform };

/** The catalog of a connection. An id that is not an id, or not in the table, is `undefined`; an entry that is not the catalog of its key throws. */
export function connectionCatalogs(table: Readonly<Record<string, ConnectionCatalog>> = PLATFORM_CATALOGS): (connectionId: string) => Promise<ConnectionCatalog | undefined> {
  return async (connectionId) => {
    if (!/^[a-z][A-Za-z0-9]*$/.test(connectionId) || !Object.hasOwn(table, connectionId)) return undefined;
    const catalog = table[connectionId];
    if (catalog.schemaVersion !== 'connection-catalog-v1' || catalog.connectionId !== connectionId || !Array.isArray(catalog.operations)) {
      throw new Error(`connection catalog ${connectionId} is not valid`);
    }
    return catalog;
  };
}
