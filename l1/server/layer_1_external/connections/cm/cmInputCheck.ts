/// <mls fileReference="_102034_/l1/server/layer_1_external/connections/cm/cmInputCheck.ts" enhancement="_blank" />
/**
 * The input of an operation the cm serves, checked against the TYPE of `cm.ts` (the source of the catalog): every alternative of a
 * union of objects, the required and the optional fields, no field that the type does not name. The type is read once per process.
 */
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import type { AsTypeNode } from '/_102034_/l1/workflow/assistantContractSource.js';
import { cmServeInputTypes } from '/_102034_/l1/server/layer_1_external/connections/cm/cmInputTypes.js';
import { cm as cmCatalog } from '/_102034_/l2/shared/contracts/connections/cm.js';

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

/**
 * The input of a served operation of the cm against its type (data of `cmInputTypes.ts`); null when it fits.
 * An operation or a type that is not there is NOT a pass: it is `unavailable` (503) with a line in the log, so a missing type is seen.
 */
export function checkCmServeInput(operationId: string, input: unknown): string | null {
  const operation = cmCatalog.operations.find((candidate) => candidate.direction === 'serve' && candidate.operationId === operationId);
  const node = operation ? cmServeInputTypes[operation.inputType] : undefined;
  if (!operation || !node) {
    console.error(`[cm] no input type for the served operation ${operationId}${operation ? ` (${operation.inputType})` : ''}: refused as unavailable`);
    throw new AppError('CM_INPUT_TYPE_MISSING', `The input type of ${operationId} is not known by this release.`, 503);
  }
  return problem(input, node, cmServeInputTypes, '', 0);
}
