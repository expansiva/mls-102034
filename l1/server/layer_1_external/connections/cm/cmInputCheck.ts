/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmInputCheck.ts" enhancement="_blank" />
/**
 * The input of an operation the cm serves, checked against the TYPE of `cm.ts` (the source of the catalog): every alternative of a
 * union of objects, the required and the optional fields, no field that the type does not name. The type is read once per process.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContractSource, type AsTypeNode } from '/_102034_/l1/workflow/assistantContractSource.js';
import { resolveProjectsPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { cm as cmCatalog } from '/_102034_/l2/shared/contracts/connections/cm.js';

type Parsed = { types: Record<string, AsTypeNode> };

let loaded: Parsed | null | undefined;
let sourceOverride: string | undefined;

/** Test only: the text of `cm.ts` to read the types from (undefined restores the file). */
export function setCmContractSourceForTests(source?: string): void {
  sourceOverride = source;
  loaded = undefined;
}

function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    // The source tree (tsx, tests): l1/server/layer_1_external/connections/cm → l2/shared/contracts/connections.
    join(here, '..', '..', '..', '..', '..', 'l2', 'shared', 'contracts', 'connections', 'cm.ts'),
    // The platform repository next to the apps, and a source copy kept in the release.
    resolveProjectsPath('mls-102034/l2/shared/contracts/connections/cm.ts'),
    resolveProjectsPath('dist/local/_102034_/l2/shared/contracts/connections/cm.ts'),
  ];
}

function types(): Parsed | null {
  if (loaded !== undefined) return loaded;
  let source = sourceOverride;
  if (source === undefined) {
    for (const file of candidates()) {
      try {
        if (existsSync(file)) {
          source = readFileSync(file, 'utf8');
          break;
        }
      } catch {
        // the next candidate
      }
    }
  }
  if (source === undefined) {
    console.warn('[cm] the source of the contract types (cm.ts) is not in this install: the input of the cm is not checked by type here');
    loaded = null;
    return loaded;
  }
  loaded = parseContractSource(source, { keepUnions: true });
  return loaded;
}

function describe(node: AsTypeNode, all: Record<string, AsTypeNode>): string {
  switch (node.kind) {
    case 'object': return `{ ${node.fields.map((field) => `${field.name}${field.optional ? '?' : ''}`).join(', ')} }`;
    case 'union': return node.members.map((member) => describe(member, all)).join(' | ');
    case 'literal': return node.values.map((value) => JSON.stringify(value)).join(' | ');
    case 'primitive': return node.name;
    case 'array': return `${describe(node.of, all)}[]`;
    case 'tuple': return `[${node.items.map((item) => describe(item, all)).join(', ')}]`;
    case 'ref': return all[node.name] ? describe(all[node.name], all) : node.name;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The first problem of `value` against `node`, as `<path>: <what>`, or null when it fits. */
function problem(value: unknown, node: AsTypeNode, all: Record<string, AsTypeNode>, path: string, depth: number): string | null {
  const here = path === '' ? 'input' : path;
  if (depth > 12) return null;
  switch (node.kind) {
    case 'primitive':
      if (node.name === 'unknown') return null;
      if (node.name === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : `${here} must be a number`;
      return typeof value === node.name ? null : `${here} must be a ${node.name}`;
    case 'literal':
      return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && node.values.includes(String(value)) ? null : `${here} is not a permitted value`;
    case 'ref': {
      if (node.name === 'null') return value === null ? null : `${here} must be null`;
      if (node.name === 'undefined') return value === undefined ? null : `${here} must be absent`;
      const resolved = all[node.name];
      return resolved ? problem(value, resolved, all, path, depth + 1) : null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${here} must be a list`;
      for (const [index, item] of value.entries()) {
        const found = problem(item, node.of, all, `${path}[${index}]`, depth + 1);
        if (found) return found;
      }
      return null;
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== node.items.length) return `${here} must be a list of ${node.items.length}`;
      for (const [index, item] of node.items.entries()) {
        const found = problem(value[index], item, all, `${path}[${index}]`, depth + 1);
        if (found) return found;
      }
      return null;
    }
    case 'object': {
      if (!isRecord(value)) return `${here} must be an object`;
      for (const key of Object.keys(value)) {
        if (value[key] !== undefined && !node.fields.some((field) => field.name === key)) return `${path === '' ? key : `${path}.${key}`} is not permitted`;
      }
      for (const field of node.fields) {
        const child = value[field.name];
        const childPath = path === '' ? field.name : `${path}.${field.name}`;
        if (child === undefined) {
          if (!field.optional) return `${childPath} is required`;
          continue;
        }
        const found = problem(child, field.type, all, childPath, depth + 1);
        if (found) return found;
      }
      return null;
    }
    case 'union': {
      const failures: string[] = [];
      for (const member of node.members) {
        const found = problem(value, member, all, path, depth + 1);
        if (found === null) return null;
        failures.push(found);
      }
      // One object alternative fits the shape of the value best: say what is wrong with it. Otherwise list the alternatives.
      if (isRecord(value)) {
        const objects = node.members.filter((member): member is Extract<AsTypeNode, { kind: 'object' }> => member.kind === 'object');
        const named = objects.filter((member) => member.fields.some((field) => !field.optional && value[field.name] !== undefined));
        if (named.length === 1) return problem(value, named[0], all, path, depth + 1);
      }
      return `${here} must be one of: ${describe(node, all)}`;
    }
  }
}

/** The input of a served operation of the cm against its type in `cm.ts`; null when it fits (or when the types are not in this install). */
export function checkCmServeInput(operationId: string, input: unknown): string | null {
  const parsed = types();
  if (parsed === null) return null;
  const operation = cmCatalog.operations.find((candidate) => candidate.direction === 'serve' && candidate.operationId === operationId);
  if (!operation) return `the cm does not serve ${operationId}`;
  const node = parsed.types[operation.inputType];
  if (!node) {
    console.warn(`[cm] the type ${operation.inputType} is not in cm.ts: the input of ${operationId} is not checked by type`);
    return null;
  }
  return problem(input, node, parsed.types, '', 0);
}
