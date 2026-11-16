/// <mls fileReference="_102034_/l1/workflow/assistantCatalogInputs.ts" enhancement="_blank"/>
import {
  flattenType,
  type AsContractRoute,
  type AsTypeLeaf,
  type AsTypeNode,
} from '/_102034_/l1/workflow/assistantContractSource.js';

/**
 * The inputs of an action, read from the type of the route in the L2 contract (what the wire carries), with the label,
 * description and enum titles of the L4 ontology entity when the release has it. Pure.
 */
export interface CatalogEnumValue {
  value: string;
  label: string;
}

export interface CatalogInput {
  /** Wire path, dot separated (what the request receives). */
  path: string;
  label: string;
  description: string;
  wireType: 'string' | 'number' | 'boolean';
  /** Ontology type when the field maps to one, else the wire type. */
  valueType: string;
  enumValues: CatalogEnumValue[];
  required: boolean;
  role: 'value' | 'ref' | 'version';
  /** Target entity when `role` is `ref`. */
  ref: string;
}

export interface OntologyField {
  title: string;
  description: string;
  type: string;
  to: string[];
  enumValues: CatalogEnumValue[];
}

export interface OntologyEntity {
  entityId: string;
  title: string;
  fields: Map<string, OntologyField>;
}

type Rec = Record<string, unknown>;

const rec = (value: unknown): Rec => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** One L4 ontology entity (`default` export of its def); `undefined` when it has no `entityId`. */
export function readOntologyEntity(raw: unknown): OntologyEntity | undefined {
  const root = rec(raw);
  const entityId = str(root.entityId);
  if (!entityId) return undefined;
  const fields = new Map<string, OntologyField>();
  const collect = (node: Rec, prefix: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const field = rec(value);
      const path = prefix ? `${prefix}.${name}` : name;
      fields.set(path, {
        title: str(field.title),
        description: str(field.description),
        type: str(field.type),
        to: arr(field.to).map(str).filter(Boolean),
        enumValues: arr(field.values).map((item) => {
          const entry = rec(item);
          return { value: str(entry.value), label: str(entry.title) || str(entry.value) };
        }).filter((entry) => entry.value !== ''),
      });
      collect(rec(field.fields), path);
    }
  };
  collect(rec(rec(root.record).fields), '');
  return { entityId, title: str(root.title) || entityId, fields };
}

/** The contract may wrap ontology paths (wire `details.details.x` for the field `details.x`): the longest suffix that is a field wins. */
function fieldOfWire(wirePath: string, entity: OntologyEntity | undefined): OntologyField | undefined {
  if (!entity) return undefined;
  const segments = wirePath.split('.');
  for (let start = 0; start < segments.length; start += 1) {
    const field = entity.fields.get(segments.slice(start).join('.'));
    if (field) return field;
  }
  return undefined;
}

function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function wireTypeOf(node: AsTypeNode): { wireType: CatalogInput['wireType']; literals: string[] } | undefined {
  if (node.kind === 'primitive') return node.name === 'unknown' ? undefined : { wireType: node.name, literals: [] };
  if (node.kind === 'literal') {
    if (node.values.every((value) => value === 'true' || value === 'false')) return { wireType: 'boolean', literals: [] };
    const numeric = node.values.every((value) => /^-?\d+(\.\d+)?$/.test(value));
    return { wireType: numeric ? 'number' : 'string', literals: node.values };
  }
  return undefined;
}

/** `undefined` when the leaf is a shape the assistant cannot fill (array, object that stays opaque, unknown). */
function inputOf(leaf: AsTypeLeaf, entity: OntologyEntity | undefined): CatalogInput | undefined {
  const wire = wireTypeOf(leaf.type);
  if (!wire) return undefined;
  const mapped = fieldOfWire(leaf.path, entity);
  const last = leaf.path.split('.').pop() ?? leaf.path;
  let role: CatalogInput['role'] = 'value';
  let ref = '';
  if (mapped?.type === 'record' && mapped.to.length > 0) {
    role = 'ref';
    ref = mapped.to[0];
  } else if (leaf.path === 'id' && entity) {
    role = 'ref';
    ref = entity.entityId;
  } else if (leaf.path === 'version') {
    role = 'version';
  }
  return {
    path: leaf.path,
    label: role === 'ref' && leaf.path === 'id' ? entity?.title || ref : mapped?.title || humanize(last),
    description: mapped?.description ?? '',
    wireType: wire.wireType,
    valueType: mapped?.type || wire.wireType,
    enumValues: wire.literals.map((value) => ({ value, label: mapped?.enumValues.find((item) => item.value === value)?.label || value })),
    required: leaf.required,
    role,
    ref,
  };
}

/**
 * Inputs of a route, or `undefined` when a required one is a shape the assistant cannot fill (an optional one it cannot
 * fill is simply never sent). `skip` holds the paging params of a query, which the caller sends by itself; a query
 * never offers `version`, which would only be a filter nobody can fill.
 */
export function inputsOfRoute(
  route: AsContractRoute,
  types: Record<string, AsTypeNode>,
  entity: OntologyEntity | undefined,
  options: { query: boolean; skip: ReadonlySet<string> },
): CatalogInput[] | undefined {
  const inputs: CatalogInput[] = [];
  for (const leaf of flattenType(route.input, types)) {
    if (options.skip.has(leaf.path)) continue;
    const input = inputOf(leaf, entity);
    if (!input) {
      if (leaf.required) return undefined;
      continue;
    }
    if (options.query && input.role === 'version') continue;
    inputs.push(input);
  }
  return inputs;
}

function resolve(node: AsTypeNode, types: Record<string, AsTypeNode>): AsTypeNode {
  return node.kind === 'ref' ? types[node.name] ?? { kind: 'primitive', name: 'unknown' } : node;
}

/** A query that only returns lists of `{ id, label }` options for a form: it is not something to ask about. */
export function returnsOnlyOptions(route: AsContractRoute, types: Record<string, AsTypeNode>): boolean {
  if (!route.output) return false;
  const output = resolve(route.output, types);
  if (output.kind !== 'object' || output.fields.length === 0) return false;
  return output.fields.every((field) => {
    const type = resolve(field.type, types);
    if (type.kind !== 'array') return false;
    const leaves = flattenType(type.of, types);
    if (leaves.length !== 2 || leaves.some((leaf) => !leaf.path || leaf.path.includes('.'))) return false;
    const id = leaves.find((leaf) => leaf.path === 'id');
    const label = leaves.find((leaf) => leaf.path !== 'id');
    return id?.type.kind === 'primitive' && id.type.name === 'string' && label?.type.kind === 'primitive' && label.type.name === 'string';
  });
}
