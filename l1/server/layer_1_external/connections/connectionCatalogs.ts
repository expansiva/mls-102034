import { distDefsReader, type DefsReader } from '/_102034_/l1/workflow/assistantCatalogDefs.js';
import type { ConnectionCatalog } from '/_102034_/l4/ontology/connections/types.defs.js';

/** The release carries its connection catalogs as emitted L4 defs of this library (`dist/local/_102034_/l4/ontology/connections/<id>.defs.js`). */
const LIBRARY_ID = '102034';

/** The catalogs of the connections, read once from the release. A file that is missing is `undefined`; one that is not a catalog throws. */
export function distConnectionCatalogs(reader: DefsReader = distDefsReader(LIBRARY_ID)): (connectionId: string) => Promise<ConnectionCatalog | undefined> {
  const cache = new Map<string, Promise<ConnectionCatalog | undefined>>();
  return (connectionId) => {
    if (!/^[a-z][A-Za-z0-9]*$/.test(connectionId)) return Promise.resolve(undefined);
    let pending = cache.get(connectionId);
    if (!pending) {
      pending = (async () => {
        const catalog = (await reader.read(`l4/ontology/connections/${connectionId}.defs.js`, 'default')) as ConnectionCatalog | undefined;
        if (catalog === undefined) return undefined;
        if (catalog.schemaVersion !== 'connection-catalog-v1' || catalog.connectionId !== connectionId || !Array.isArray(catalog.operations)) {
          throw new Error(`connection catalog ${connectionId} is not valid`);
        }
        return catalog;
      })();
      cache.set(connectionId, pending);
    }
    return pending;
  };
}
