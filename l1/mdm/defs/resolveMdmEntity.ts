/// <mls fileReference="_102034_/l1/mdm/defs/resolveMdmEntity.ts" enhancement="_blank" />
/**
 * The reader of the ontology: it turns `l4/ontology/mdm.defs.ts` (the platform) and a module ontology in
 * the v3 form (`mls-<client>/l4/<module>/ontology/<Entity>.defs.ts`) into ONE view — the columns, the
 * `details` tree, the links, the capabilities and the rules of a single entity (ns5_39 T3).
 *
 * PURE ON PURPOSE. No `node:*`, no engine (`module.ts`, `mdmFacade.ts`, `persistence.ts`), no I/O: the
 * clarification screen imports this file in the browser and hands it two objects it already read.
 * `resolveMdmEntity.test.ts` asserts that purity against this file's own source, so it cannot rot.
 *
 * What it does NOT do: it does not validate. A divergence is reported ON the node (`conflict`,
 * `tightened`, `unresolved`) for the screen to show — never thrown, never silently repaired. The gate is
 * `ontology30`, and it is still v2 (out of scope here).
 */

import type {
  MdmDefField,
  MdmDefFields,
  MdmOntology,
  MdmSubtypeName,
} from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import type {
  Ns5OntologyEntityV3,
  Ns5OntologyFieldV3,
  Ns5OntologyFieldsV3,
  Ns5OntologyIndexV3,
  Ns5OntologyRelationshipV3,
  Ns5RulesArtifact,
} from '/_102035_/l2/solution/types.js';

/** How ready the platform is, read from the tail of the catalog sentence. A badge, never a gate. */
export type OntologyPlatformStatus = 'ready' | 'partial' | 'missing';

/** Who writes the field. `derived` wins over `platform`: the engine owns it, so no form may offer it. */
export type OntologyOrigin = 'platform' | 'module' | 'derived';

export interface OntologyValue {
  value: string;
  title: string;
}

export interface OntologyNode {
  /** Field id inside its parent. */
  id: string;
  /** Full path from the record root: `details.identification.name`, `scheduledAt`. */
  path: string;
  title: string;
  type: string;
  required: boolean;
  nullable: boolean;
  collection: boolean;
  derived: boolean;
  indexed: boolean;
  unique: boolean;
  /** Reusable value type of `mdm.types`. */
  of?: string;
  /** Records this field points at. */
  to?: readonly string[];
  values?: readonly OntologyValue[];
  /** Only on a branch of `details`. */
  owner?: 'platform' | 'organization' | 'module';
  /** The branch declares no closed key set (`general`, the module namespace on the platform side). */
  open?: true;
  description?: string;
  /** Only on a module view. */
  origin?: OntologyOrigin;
  /** The module declares a field the platform already owns under that branch, or an identity field
   * inside its own namespace (`rule-identity-never-in-namespace`). The screen warns. */
  conflict?: true;
  /** The module narrowed a closed domain the platform declares wider. Legitimate; shown as a note. */
  tightened?: true;
  children?: OntologyNode[];
}

export interface OntologyRelationshipView {
  /** The name the entity gave the link; on the platform view, the catalog type. */
  name: string;
  /** The row of the module index that carries it. Absent on the platform view. */
  relationshipId?: string;
  /** Catalog type (`GuardianOf`), or the column / table walked. */
  via: string;
  title: string;
  description?: string;
  /** The far end. */
  to: readonly string[];
  /** Which end of the link this entity sits on. */
  side: 'from' | 'to' | 'both';
  mode: 'fk' | 'throughTable' | 'mdmRelationship';
  cardinality?: string;
  required?: boolean | string;
  roles?: readonly string[];
  path?: string;
  derived?: true;
  /** Says how the entity and the module index disagree. The index is the source. */
  conflict?: string;
}

export interface OntologyCapabilityView {
  id: string;
  /** The catalog sentence for a platform id; the module sentence for a module id. */
  sentence: string;
  /** Only on a platform id: what the platform sentence says about itself. */
  platform?: OntologyPlatformStatus;
  origin: 'platform' | 'module';
  /** Only on a module view of a platform id: what the module says it uses it for. */
  moduleSentence?: string;
  /** The id is in no catalog. */
  unresolved?: true;
}

export interface OntologyRuleView {
  id: string;
  text: string;
  platform?: OntologyPlatformStatus;
  origin: 'platform' | 'module';
  unresolved?: true;
}

export interface OntologyTreeView {
  entityId: string;
  title: string;
  description: string;
  kind: 'platform' | 'role' | 'entity';
  /** The MDM subtype, on the platform view and on a role. */
  subtype?: string;
  displayField: string;
  /**
   * The top-level fields of the record OTHER than `details` — `details` is returned expanded below.
   * `{ id, version }` on an MDM record; on a module table also every indexed column.
   */
  columns: OntologyNode[];
  /** The branches of the document, in the order `record.fields.details.groups` declares. */
  details: OntologyNode[];
  relationships: OntologyRelationshipView[];
  capabilities: OntologyCapabilityView[];
  rules: OntologyRuleView[];
}

// --- small pure helpers -----------------------------------------------------

const STATUS_PATTERN = /platform:\s*(ready|partial|missing)/;

/** The badge, read from the tail of the catalog sentence. Absent when the sentence does not say. */
export function readPlatformStatus(sentence: string): OntologyPlatformStatus | undefined {
  const found = STATUS_PATTERN.exec(sentence);
  return found ? (found[1] as OntologyPlatformStatus) : undefined;
}

function uncapitalize(name: string): string {
  return name ? name[0].toLowerCase() + name.slice(1) : name;
}

/** Platform values are bare codes, module values are `{ value, title }`. One shape for both. */
function normalizeValues(values: Ns5OntologyFieldV3['values']): OntologyValue[] | undefined {
  if (!values) return undefined;
  return values.map(item => (typeof item === 'string'
    ? { value: item, title: item }
    : { value: item.value, title: item.title ?? item.value }));
}

function joinPath(parent: string, id: string): string {
  return parent ? `${parent}.${id}` : id;
}

type AnyField = MdmDefField | Ns5OntologyFieldV3;

function toNode(id: string, field: AnyField, parentPath: string): OntologyNode {
  const wide = field as Ns5OntologyFieldV3;
  const node: OntologyNode = {
    id,
    path: joinPath(parentPath, id),
    title: wide.title ?? id,
    type: wide.type,
    required: wide.required === true,
    nullable: wide.nullable === true,
    collection: wide.collection === true,
    derived: wide.derived === true,
    indexed: wide.indexed === true,
    unique: wide.unique === true,
  };
  if (wide.of) node.of = wide.of;
  if (wide.to) node.to = wide.to as readonly string[];
  const values = normalizeValues(wide.values);
  if (values) node.values = values;
  if (wide.owner) node.owner = wide.owner;
  if (wide.open) node.open = wide.open;
  if (wide.description) node.description = wide.description;
  return node;
}

function childrenOf(fields: MdmDefFields | Ns5OntologyFieldsV3 | undefined, parentPath: string): OntologyNode[] {
  if (!fields) return [];
  return Object.entries(fields).map(([id, field]) => {
    const node = toNode(id, field as AnyField, parentPath);
    const nested = (field as Ns5OntologyFieldV3).fields;
    if (nested) node.children = childrenOf(nested, node.path);
    return node;
  });
}

function capabilityOwners(mdm: MdmOntology): Set<string> {
  const owned = new Set<string>();
  for (const subtype of Object.values(mdm.subtypes)) {
    for (const id of subtype.capabilities ?? []) owned.add(id);
  }
  return owned;
}

function ruleOwners(mdm: MdmOntology): Set<string> {
  const owned = new Set<string>();
  for (const subtype of Object.values(mdm.subtypes)) {
    for (const id of subtype.rules ?? []) owned.add(id);
  }
  return owned;
}

/** A capability with no `appliesTo` list belongs to every subtype; the deltas are what the subtypes claim. */
function universalIds(all: Readonly<Record<string, string>>, claimed: Set<string>): string[] {
  return Object.keys(all).filter(id => !claimed.has(id));
}

// --- the platform view ------------------------------------------------------

/**
 * The whole platform record of one subtype: `{ id, version }` plus the five branches of `details`, the
 * relationship types the subtype takes part in, and the capabilities and rules that reach it.
 *
 * `moduleId` names the module namespace branch; without it the branch keeps the placeholder key
 * `<moduleId>` the ontology itself uses.
 */
export function resolvePlatformEntity(
  mdm: MdmOntology,
  subtype: MdmSubtypeName,
  moduleId?: string,
): OntologyTreeView {
  const definition = mdm.subtypes[subtype];
  const detailsField = mdm.record.fields.details;
  const branchOrder = detailsField?.groups ?? Object.keys(mdm.groups);

  const columns = Object.entries(mdm.record.fields)
    .filter(([id]) => id !== 'details')
    .map(([id, field]) => toNode(id, field, ''));

  const details: OntologyNode[] = [];
  for (const branch of branchOrder) {
    if (branch === '<subtype>') {
      const key = uncapitalize(subtype);
      details.push({
        ...toNode(key, { type: 'object', required: true, owner: 'platform', description: definition.description }, 'details'),
        children: childrenOf(definition.fields, `details.${key}`),
      });
      continue;
    }
    const group = mdm.groups[branch];
    if (!group) continue;
    const key = branch === '<moduleId>' && moduleId ? moduleId : branch;
    const node = toNode(key, { ...group, required: true } as AnyField, 'details');
    node.children = childrenOf(group.fields, node.path);
    details.push(node);
  }

  const relationships: OntologyRelationshipView[] = [];
  for (const entry of mdm.relationships) {
    const isFrom = entry.from.includes(subtype);
    const isTo = entry.to.includes(subtype);
    if (!isFrom && !isTo) continue;
    relationships.push({
      name: entry.type,
      via: entry.type,
      title: entry.title,
      description: entry.description,
      to: isFrom ? entry.to : entry.from,
      side: isFrom && isTo ? 'both' : isFrom ? 'from' : 'to',
      mode: 'mdmRelationship',
      roles: entry.roles,
    });
  }

  const capabilityIds = [...universalIds(mdm.capabilities, capabilityOwners(mdm)), ...(definition.capabilities ?? [])];
  const capabilities: OntologyCapabilityView[] = capabilityIds.map(id => {
    const sentence = mdm.capabilities[id] ?? '';
    return { id, sentence, platform: readPlatformStatus(sentence), origin: 'platform' as const };
  });

  const ruleIds = [...universalIds(mdm.rules, ruleOwners(mdm)), ...(definition.rules ?? [])];
  const rules: OntologyRuleView[] = ruleIds.map(id => {
    const text = mdm.rules[id] ?? '';
    return { id, text, platform: readPlatformStatus(text), origin: 'platform' as const };
  });

  return {
    entityId: subtype,
    title: definition.title ?? subtype,
    description: definition.description,
    kind: 'platform',
    subtype,
    displayField: `details.${mdm.record.displayField}`,
    columns,
    details,
    relationships,
    capabilities,
    rules,
  };
}

// --- the module view --------------------------------------------------------

/** Where a branch of a module `details` comes from on the platform side. */
function platformFieldsOfBranch(
  mdm: MdmOntology,
  branch: string,
  subtype: MdmSubtypeName | undefined,
): MdmDefFields | undefined {
  if (subtype && branch === uncapitalize(subtype)) return mdm.subtypes[subtype].fields;
  return mdm.groups[branch]?.fields;
}

/** Every field id the platform owns on a record: what a module namespace must never redeclare. */
function platformFieldIds(mdm: MdmOntology, subtype: MdmSubtypeName | undefined): Set<string> {
  const ids = new Set<string>();
  for (const group of Object.values(mdm.groups)) {
    for (const id of Object.keys(group.fields ?? {})) ids.add(id);
  }
  if (subtype) for (const id of Object.keys(mdm.subtypes[subtype].fields)) ids.add(id);
  return ids;
}

function markAgainstPlatform(node: OntologyNode, platformField: MdmDefField | undefined): void {
  if (!platformField) {
    node.origin = 'module';
    return;
  }
  node.origin = node.derived || platformField.derived === true ? 'derived' : 'platform';
  const mine = node.values;
  const theirs = normalizeValues(platformField.values);
  if (mine && theirs && mine.length < theirs.length) {
    const wider = new Set(theirs.map(item => item.value));
    if (mine.every(item => wider.has(item.value))) node.tightened = true;
  }
}

/**
 * The entity of a module, read against the platform it sits on.
 *
 * On a `role`, every node of `details` is marked `platform` / `module` / `derived` by comparing it with
 * the branch the platform declares; a module field that shadows a platform field — or any identity field
 * inside the module namespace — is flagged `conflict`. The capabilities and rules keep BOTH sentences:
 * the catalog's (what the platform does) and the module's (what the clinic uses it for). The links are
 * crossed with the module index, which is the source; a disagreement becomes `conflict` on the link.
 */
export function resolveModuleEntity(
  entity: Ns5OntologyEntityV3,
  index: Ns5OntologyIndexV3,
  mdm: MdmOntology,
  moduleRules: Ns5RulesArtifact,
): OntologyTreeView {
  const subtype = entity.kind === 'role' ? entity.subtype : undefined;
  const namespaceKey = index.moduleNamespace?.key ?? entity.moduleName;
  const ownedByPlatform = platformFieldIds(mdm, subtype);

  const columns = Object.entries(entity.record.fields)
    .filter(([id]) => id !== 'details')
    .map(([id, field]) => {
      const node = toNode(id, field, '');
      if (subtype) markAgainstPlatform(node, mdm.record.fields[id]);
      else node.origin = node.derived ? 'derived' : 'module';
      return node;
    });

  const details: OntologyNode[] = [];
  const detailsFields = entity.record.fields.details?.fields;
  for (const [branch, group] of Object.entries(detailsFields ?? {})) {
    const node = toNode(branch, group, 'details');
    // On a role the branches of the document are the platform's; on a module table `details` is flat.
    if (entity.kind !== 'role') {
      // A module table (`Consulta`): `details` holds plain fields, not branches.
      node.origin = node.derived ? 'derived' : 'module';
      if (group.fields) node.children = childrenOf(group.fields, node.path);
      details.push(node);
      continue;
    }
    node.origin = group.owner === 'platform' ? 'platform' : 'module';
    const platformFields = platformFieldsOfBranch(mdm, branch, subtype);
    const isNamespace = branch === namespaceKey;
    node.children = Object.entries(group.fields ?? {}).map(([id, field]) => {
      const child = toNode(id, field, node.path);
      if (field.fields) child.children = childrenOf(field.fields, child.path);
      if (isNamespace) {
        child.origin = child.derived ? 'derived' : 'module';
        // rule-identity-never-in-namespace: the namespace may not redeclare what the platform owns.
        if (ownedByPlatform.has(id)) child.conflict = true;
        return child;
      }
      const platformField = platformFields?.[id];
      markAgainstPlatform(child, platformField);
      // A platform-owned branch carrying a field the platform does not declare: the module shadows it.
      if (!platformField && group.owner === 'platform') child.conflict = true;
      return child;
    });
    details.push(node);
  }

  const indexById = new Map(index.relationships.map(row => [row.relationshipId, row]));
  const relationships: OntologyRelationshipView[] = Object.entries(entity.relationships).map(([name, link]) => {
    const view = viewOfModuleLink(name, link);
    const row = indexById.get(link.relationshipId);
    if (!row) {
      view.conflict = `relationshipId ${link.relationshipId} is in no row of the module index`;
      return view;
    }
    const thisEnd = row.from === entity.entityId ? 'from' : row.to === entity.entityId ? 'to' : undefined;
    if (!thisEnd) {
      view.conflict = `the index row ${row.relationshipId} links ${row.from} to ${row.to}, neither is ${entity.entityId}`;
    } else {
      const farEnd = thisEnd === 'from' ? row.to : row.from;
      if (farEnd !== link.to) {
        view.conflict = `the entity points at ${link.to} and the index row ${row.relationshipId} at ${farEnd}`;
      } else if (row.mode !== view.mode) {
        view.conflict = `the entity says ${view.mode} and the index row ${row.relationshipId} says ${row.mode}`;
      }
      view.side = thisEnd;
    }
    return view;
  });

  const moduleRuleTexts = new Map(moduleRules.rules.map(rule => [rule.ruleId, rule.description]));
  const capabilities: OntologyCapabilityView[] = Object.entries(entity.capabilities).map(([id, written]) => {
    const sentence = written ?? '';
    const catalog = mdm.capabilities[id];
    if (catalog !== undefined) {
      return {
        id,
        sentence: catalog,
        platform: readPlatformStatus(catalog),
        origin: 'platform' as const,
        moduleSentence: sentence,
      };
    }
    const view: OntologyCapabilityView = { id, sentence, origin: 'module' as const };
    if (!id.startsWith(`${entity.moduleName}.`)) view.unresolved = true;
    return view;
  });

  const rules: OntologyRuleView[] = entity.rules.map(id => {
    const catalog = mdm.rules[id];
    if (catalog !== undefined) {
      return { id, text: catalog, platform: readPlatformStatus(catalog), origin: 'platform' as const };
    }
    const own = moduleRuleTexts.get(id);
    if (own !== undefined) return { id, text: own, origin: 'module' as const };
    return { id, text: '', origin: 'module' as const, unresolved: true };
  });

  return {
    entityId: entity.entityId,
    title: entity.title,
    description: entity.description,
    kind: entity.kind,
    subtype,
    displayField: entity.displayField,
    columns,
    details,
    relationships,
    capabilities,
    rules,
  };
}

function viewOfModuleLink(name: string, link: Ns5OntologyRelationshipV3): OntologyRelationshipView {
  const view: OntologyRelationshipView = {
    name,
    relationshipId: link.relationshipId,
    via: link.via,
    title: link.title,
    to: [link.to],
    // A link with no `mode` is a link of the MDM catalog; `via` is then the catalog type.
    side: link.direction === 'to' ? 'to' : 'from',
    mode: link.mode ?? 'mdmRelationship',
    cardinality: link.cardinality,
  };
  if (link.description) view.description = link.description;
  if (link.required !== undefined) view.required = link.required;
  if (link.roles) view.roles = link.roles;
  else if (link.role) view.roles = [link.role];
  if (link.path) view.path = link.path;
  if (link.derived) view.derived = link.derived;
  return view;
}
