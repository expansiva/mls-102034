/// <mls fileReference="_102034_/l2/shared/contracts/connections/platform.ts" enhancement="_blank"/>
/**
 * The connection of the platform to the module that serves it (the connections contract (conexoes.md) §5, M5): the release
 * routine delivers the catalog of actions of every module of the release. The catalog has the shape that
 * `buildCatalogFromDefs` (`l1/workflow/assistantCatalogDefs.ts`) returns.
 */
import type { ConnectionCatalog } from '/_102034_/l2/shared/contracts/connections/types.js';

/** One action of the catalog of a module, as `buildCatalogFromDefs` returns it. */
export interface PlatformCatalogAction {
  route: string;
  routes: string[];
  module: string;
  kind: 'cmd' | 'qry';
  actionId: string;
  title: string;
  purpose?: string;
  /** The entity the action is about (`entityId`), or `general`. */
  subject: string;
  subjectTitle?: string;
  moduleTitle?: string;
  actors: string[];
  assistant: 'included' | 'excluded';
  risk: string;
  inputs: Array<{ path: string; label: string; description: string; wireType: string; valueType: string; enumValues: Array<{ value: string; label: string }>; required: boolean; role: 'value' | 'ref' | 'version'; ref: string }>;
  page?: { address: string; recordParam?: string };
}

/** The catalog of one module. `issues` carries what could not be read; the receiver may show it, never hides it. */
export interface PlatformModuleCatalog {
  schemaVersion: 'assistant-catalog-v1';
  module: string;
  title?: string;
  description?: string;
  commands: PlatformCatalogAction[];
  queries: PlatformCatalogAction[];
  issues: string[];
}

export interface PlatformReleaseCatalogChangedInput {
  releaseId: string;
  /** Hash of the catalogs of the release; the same hash is never delivered twice. */
  hash: string;
  catalogs: PlatformModuleCatalog[];
}
export type PlatformReleaseCatalogChangedOutput = Record<string, never>;

export const platform: ConnectionCatalog = {
  "schemaVersion": "connection-catalog-v1",
  "connectionId": "platform",
  "title": "Platform",
  "description": "What the platform tells a module: the release changed, and here is the catalog of actions of every module of the release.",
  "operations": [
    { "operationId": "releaseCatalogChanged", "direction": "serve", "kind": "command", "description": "The release routine delivers the catalog of actions of every module of the release.", "inputType": "PlatformReleaseCatalogChangedInput", "outputType": "PlatformReleaseCatalogChangedOutput", "reply": "now", "hiddenFromAgents": true }
  ]
};

export default platform;
