/// <mls fileReference="_102034_/l1/mdm/defs/resolveMdmEntity.test.ts" enhancement="_blank" />
/**
 * Proof for `resolveMdmEntity.ts` and for the v3 type of a module ontology (ns5_39 T2 + T3).
 *
 * WHY THE COMPILE PROOF IS HERE AND NOT ONLY IN `mls-102035/l2/solution/ontologyV3.test.ts`: measured in
 * this task — `tsconfig.frontend.json` excludes `**\/*.test.ts`, so a type error in an `l2` test is
 * invisible to the certification (probe: a deliberate `const x: number = "boom"` in `l2/solution` was
 * reported by `tsconfig.json` and NOT by `tsconfig.frontend.json`). `tsconfig.backend.json` excludes only
 * `*.spec.ts`, so an `l1` test IS type-checked — that is why `mdmOntology.test.ts:82-89` can lean on
 * `@ts-expect-error`. Passing the three agendaClinica files to `resolveModuleEntity`, whose parameter is
 * `Ns5OntologyEntityV3`, therefore makes the compiler prove they satisfy the type, under a listed command.
 *
 * The `l4` files enter the backend program only through the imports below (ns5_37).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { MdmSubtypeName } from '/_102034_/l1/mdm/defs/ontologyTypes.js';
import {
  resolveModuleEntity,
  resolvePlatformEntity,
  type OntologyNode,
  type OntologyTreeView,
} from '/_102034_/l1/mdm/defs/resolveMdmEntity.js';
import { mdm } from '/_102034_/l4/ontology/mdm.defs.js';
import type { Ns5OntologyEntityV3, Ns5OntologyIndexV3 } from '/_102035_/l2/solution/types.js';
import { agendaClinicaRules } from '/_102047_/l4/agendaClinica/rules.defs.js';
import { agendaClinicaEntityConsulta } from '/_102047_/l4/agendaClinica/ontology/Consulta.defs.js';
import { agendaClinicaEntityPaciente } from '/_102047_/l4/agendaClinica/ontology/Paciente.defs.js';
import { agendaClinicaEntityProfissional } from '/_102047_/l4/agendaClinica/ontology/Profissional.defs.js';
import { agendaClinicaOntologyIndex } from '/_102047_/l4/agendaClinica/ontology/index.defs.js';

// ---------------------------------------------------------------------------
// T2 — the cross-references, checked by the compiler (same method as mdmOntology.test.ts)
// ---------------------------------------------------------------------------

type PlatformCapabilityId = keyof typeof mdm.capabilities;
type PlatformRuleId = keyof typeof mdm.rules;
type ModuleCapabilityId = `agendaClinica.${string}`;
type ModuleRuleId = typeof agendaClinicaRules.rules[number]['ruleId'];
type CatalogType = typeof mdm.relationships[number]['type'];
type IndexRelationshipId = typeof agendaClinicaOntologyIndex.relationships[number]['relationshipId'];

type CapabilityId = PlatformCapabilityId | ModuleCapabilityId;
type RuleId = PlatformRuleId | ModuleRuleId;
type AgendaEntity = Ns5OntologyEntityV3<CapabilityId, RuleId>;

/**
 * (a) The three files ARE the v3 type — `of`, `subtype`, `kind`, the field grammar and the relationship
 * shape all ride on this assignment. `capabilities` is `Record<CapabilityId, string>`, but a `const` is
 * not a fresh literal, so assignment alone does NOT reject an extra key; `NoExtra` below closes that hole.
 */
const paciente: AgendaEntity = agendaClinicaEntityPaciente;
const profissional: AgendaEntity = agendaClinicaEntityProfissional;
const consulta: AgendaEntity = agendaClinicaEntityConsulta;
const agendaIndex: Ns5OntologyIndexV3 = agendaClinicaOntologyIndex;

/** `true` when every key of `T` is in `U`; otherwise the offending keys, which `true` cannot absorb. */
type KeysWithin<T, U extends string> = Exclude<keyof T, U> extends never ? true : Exclude<keyof T, U>;

// (b) every capability id is a platform id or `agendaClinica.<id>`.
const _pacienteCaps: KeysWithin<typeof agendaClinicaEntityPaciente.capabilities, CapabilityId> = true;
const _profissionalCaps: KeysWithin<typeof agendaClinicaEntityProfissional.capabilities, CapabilityId> = true;
const _consultaCaps: KeysWithin<typeof agendaClinicaEntityConsulta.capabilities, CapabilityId> = true;

// (c) every rule id is a platform rule or a ruleId of the module `rules.defs.ts`.
const _pacienteRules: readonly RuleId[] = agendaClinicaEntityPaciente.rules;
const _profissionalRules: readonly RuleId[] = agendaClinicaEntityProfissional.rules;
const _consultaRules: readonly RuleId[] = agendaClinicaEntityConsulta.rules;

// (d) every `of` is a reusable type of the platform — carried by `Ns5OntologyFieldV3['of']`, which is
// `MdmValueTypeName` and NOT widened. Named here so the reason survives.
const _addressOf: keyof typeof mdm.types = agendaClinicaEntityPaciente.record.fields.details.fields.base.fields.addresses.of;
const _consentOf: keyof typeof mdm.types = agendaClinicaEntityPaciente.record.fields.details.fields.person.fields.privacyConsent.of;

// (e) the subtype of each role is a subtype of the platform.
const _pacienteSubtype: keyof typeof mdm.subtypes = agendaClinicaEntityPaciente.subtype;
const _profissionalSubtype: keyof typeof mdm.subtypes = agendaClinicaEntityProfissional.subtype;

// (f) the `via` of a link with no `mode` is a relationship type of the catalog.
const _viaContatos: CatalogType = agendaClinicaEntityPaciente.relationships.contatos.via;
const _viaResponsavel: CatalogType = agendaClinicaEntityPaciente.relationships.responsavel.via;
const _viaEmergencia: CatalogType = agendaClinicaEntityPaciente.relationships.contatoEmergencia.via;
const _catalogTypeOfIndex: CatalogType = agendaClinicaOntologyIndex.relationships[2].catalogType;

// (g) every `relationshipId` an entity repeats is a row of the index.
const _ridPaciente: readonly IndexRelationshipId[] =
  Object.values(agendaClinicaEntityPaciente.relationships).map(link => link.relationshipId);
const _ridConsulta: readonly IndexRelationshipId[] =
  Object.values(agendaClinicaEntityConsulta.relationships).map(link => link.relationshipId);

// (h) the negative half. Each line must fail for the reason its comment claims.
// @ts-expect-error — a capability id in no catalog and outside the module namespace.
const strayCapability: CapabilityId = 'locate.byVibes';
// @ts-expect-error — a reusable type that does not exist.
const strayOf: Ns5OntologyEntityV3['record']['fields'][string]['of'] = 'PostalAddress';
// @ts-expect-error — a rule id that is in neither catalog.
const strayRule: RuleId = 'consultaSempreDeManha';
// @ts-expect-error — a relationship type that is in no catalog.
const strayVia: CatalogType = 'BestFriendOf';
// @ts-expect-error — a subtype the platform does not declare.
const straySubtype: MdmSubtypeName = 'Clinica';

test('(T2) the agendaClinica v3 files satisfy the v3 type and every id resolves', () => {
  // Compiling is the assertion; these keep the bindings live at runtime.
  void _pacienteCaps; void _profissionalCaps; void _consultaCaps;
  void _pacienteRules; void _profissionalRules; void _consultaRules;
  void _addressOf; void _consentOf; void _pacienteSubtype; void _profissionalSubtype;
  void _viaContatos; void _viaResponsavel; void _viaEmergencia; void _catalogTypeOfIndex;
  void _ridPaciente; void _ridConsulta;
  void strayCapability; void strayOf; void strayRule; void strayVia; void straySubtype;
  assert.equal(paciente.schemaVersion, '2026-09-15-ns5-ontology-v3');
  assert.equal(profissional.schemaVersion, '2026-09-15-ns5-ontology-v3');
  assert.equal(consulta.schemaVersion, '2026-09-15-ns5-ontology-v3');
  assert.equal(agendaIndex.schemaVersion, '2026-09-15-ns5-ontology-v3');
});

// ---------------------------------------------------------------------------
// T3 — the resolver
// ---------------------------------------------------------------------------

function branch(view: OntologyTreeView, id: string): OntologyNode {
  const found = view.details.find(node => node.id === id);
  assert.ok(found, `the resolved view has no branch ${id}; it has ${view.details.map(n => n.id).join(', ')}`);
  return found;
}

function child(node: OntologyNode, id: string): OntologyNode {
  const found = (node.children ?? []).find(item => item.id === id);
  assert.ok(found, `${node.path} has no field ${id}`);
  return found;
}

const modulo = () => resolveModuleEntity(paciente, agendaIndex, mdm, agendaClinicaRules);

test('(T3) the platform Person resolves to five branches and seventeen links', () => {
  const view = resolvePlatformEntity(mdm, 'Person', 'agendaClinica');

  assert.deepEqual(view.details.map(node => node.id), ['identification', 'base', 'person', 'general', 'agendaClinica']);
  assert.equal(view.relationships.length, 17);
  assert.ok(view.relationships.every(link => link.side === 'from' || link.side === 'to' || link.side === 'both'));
  // `side: 'both'` says the subtype sits on BOTH ends of the type, not that the type is bidirectional:
  // ReportsTo and GuardianOf run Person → Person without being symmetric; only Family is symmetric.
  assert.deepEqual(
    view.relationships.filter(link => link.side === 'both').map(link => link.name),
    ['ReportsTo', 'Family', 'GuardianOf'],
  );

  /*
   * `columns` is every top-level field of `record` OTHER than `details` — `details` comes back expanded
   * as the tree, and returning it twice would make the screen show it twice. The spec's own parenthetical
   * "(id, version, details)" and its assertion "Consulta tem 6 colunas" cannot both hold, because
   * `details` is a real column on both sides; the executable number wins (see the return of ns5_39).
   */
  assert.deepEqual(view.columns.map(node => node.id), ['id', 'version']);

  // The subtype branch is synthesised: `mdm.groups` has four keys, the fifth comes from subtypes.Person.
  assert.deepEqual(Object.keys(mdm.groups).length, 4);
  assert.equal(branch(view, 'person').children?.length, Object.keys(mdm.subtypes.Person.fields).length);
  // Without a moduleId the namespace branch keeps the placeholder the ontology itself uses.
  assert.ok(resolvePlatformEntity(mdm, 'Person').details.some(node => node.id === '<moduleId>'));

  // 22 universal + the 4 Person claims; 4 universal rules + the 2 Person claims. By NAME, because the
  // count 6 also happens to be Paciente's, and a swap would hide behind it.
  assert.equal(view.capabilities.length, 26);
  assert.deepEqual([...view.rules.map(item => item.id)].sort(), [
    'rule-delete-blocked-by-relationships',
    'rule-document-shape-validated',
    'rule-foreign-namespace-refused',
    'rule-identity-never-in-namespace',
    'rule-person-privacy-consent-required-br-eu',
    'rule-person-ssn-unique-for-us',
  ]);
  assert.ok(view.capabilities.every(item => item.platform), 'every catalog sentence carries a status');
  assert.equal(view.capabilities.find(item => item.id === 'locate.semantic')?.platform, 'missing');
  assert.equal(view.capabilities.find(item => item.id === 'link')?.platform, 'ready');

  // A field the engine writes is `derived`, never an editable platform field.
  assert.equal(child(branch(view, 'identification'), 'tags').derived, true);
  assert.equal(child(branch(view, 'identification'), 'name').path, 'details.identification.name');
});

test('(T3) the platform view works for a subtype that is not Person', () => {
  // Person is the only subtype the module uses, so the two paths it does not exercise are checked here:
  // a multi-word subtype key (`AssetVehicle` → `assetVehicle`) and a subtype with no `title` of its own.
  const view = resolvePlatformEntity(mdm, 'AssetVehicle', 'agendaClinica');
  assert.deepEqual(view.details.map(node => node.id), ['identification', 'base', 'assetVehicle', 'general', 'agendaClinica']);
  assert.equal(view.title, 'AssetVehicle');
  assert.equal(view.entityId, 'AssetVehicle');
  assert.equal(branch(view, 'assetVehicle').children?.length, Object.keys(mdm.subtypes.AssetVehicle.fields).length);
  // It takes part in two links, on opposite ends: something owns it, and it owns its contact channels.
  assert.deepEqual(view.relationships.map(link => link.name), ['Owns', 'HasContact']);
  assert.equal(view.relationships[0].side, 'to');
  assert.equal(view.relationships[1].side, 'from');
  // No delta of its own: the universal catalogs, nothing more.
  assert.equal(view.capabilities.length, 22);
  assert.equal(view.rules.length, 4);
});

test('(T3) Paciente resolves against the platform: branches, origin, tightened domain', () => {
  const view = modulo();

  assert.equal(view.kind, 'role');
  assert.equal(view.subtype, 'Person');
  assert.deepEqual(view.details.map(node => node.id), ['identification', 'base', 'person', 'general', 'agendaClinica']);

  const namespace = branch(view, 'agendaClinica');
  assert.equal(namespace.owner, 'module');
  assert.equal(namespace.origin, 'module');

  const identification = branch(view, 'identification');
  assert.equal(child(identification, 'name').origin, 'platform');
  assert.equal(child(identification, 'docId').origin, 'platform');
  // `tags` and `status` are written by the engine: derived beats platform, or a form would offer them.
  assert.equal(child(identification, 'tags').origin, 'derived');
  assert.equal(child(identification, 'status').origin, 'derived');
  assert.ok(!view.details.some(node => (node.children ?? []).some(item => item.conflict)), 'no field shadows the platform');

  // docType: platform, and tightened — the platform declares nine document types, the clinic one.
  const docType = child(identification, 'docType');
  assert.equal(docType.origin, 'platform');
  assert.equal(docType.tightened, true);
  assert.deepEqual(docType.values, [{ value: 'CPF', title: 'CPF' }]);
  assert.equal((mdm.groups.identification.fields.docType.values ?? []).length, 9);
  // `name` is not an enum, so it is not "tightened" by accident.
  assert.equal(child(identification, 'name').tightened, undefined);

  assert.deepEqual(view.columns.map(node => node.id), ['id', 'version']);
  assert.equal(view.displayField, 'details.identification.name');
});

test('(T3) Paciente keeps both sentences on a capability and resolves every rule', () => {
  const view = modulo();

  /*
   * Fifteen, not the sixteen the spec assumed: `Paciente.defs.ts:342-358` declares thirteen platform ids
   * plus `agendaClinica.listarConsultas` and `agendaClinica.listarProfissionais`. Reported in ns5_39.
   */
  assert.equal(view.capabilities.length, 15);
  assert.equal(view.capabilities.filter(item => item.origin === 'platform').length, 13);
  assert.equal(view.capabilities.filter(item => item.origin === 'module').length, 2);
  assert.ok(!view.capabilities.some(item => item.unresolved), 'every capability id resolves');

  const byName = view.capabilities.find(item => item.id === 'locate.byName');
  assert.ok(byName);
  assert.equal(byName.platform, 'partial');
  assert.match(byName.sentence, /aliases are not consulted/); // the catalog sentence
  assert.match(String(byName.moduleSentence), /Recepção localiza o paciente/); // and the module's

  assert.equal(view.rules.length, 6);
  assert.equal(view.rules.filter(item => item.origin === 'platform').length, 3);
  assert.equal(view.rules.filter(item => item.origin === 'module').length, 3);
  assert.ok(!view.rules.some(item => item.unresolved), 'every rule id resolves');
  assert.equal(view.rules.find(item => item.id === 'rule-identity-never-in-namespace')?.platform, 'partial');
  assert.equal(
    view.rules.find(item => item.id === 'menorExigeResponsavel')?.text,
    agendaClinicaRules.rules.find(rule => rule.ruleId === 'menorExigeResponsavel')?.description,
  );
});

test('(T3) the links of an entity are crossed with the module index, which is the source', () => {
  const view = modulo();

  assert.equal(view.relationships.length, 5);
  assert.deepEqual(view.relationships.filter(link => link.conflict).map(link => link.conflict), []);

  const responsavel = view.relationships.find(link => link.name === 'responsavel');
  assert.ok(responsavel);
  assert.equal(responsavel.via, 'GuardianOf');
  assert.equal(responsavel.mode, 'mdmRelationship');
  // The index row runs Person → Paciente, so Paciente is the `to` end even though the entity lists it.
  assert.equal(responsavel.side, 'to');
  assert.deepEqual(responsavel.roles, ['parent', 'guardian']);
  assert.equal(responsavel.required, 'quando menor de 18 anos');

  const profissionais = view.relationships.find(link => link.name === 'profissionais');
  assert.equal(profissionais?.mode, 'throughTable');
  assert.equal(profissionais?.derived, true);

  const consultaView = resolveModuleEntity(consulta, agendaIndex, mdm, agendaClinicaRules);
  assert.equal(consultaView.relationships.length, 2);
  assert.ok(consultaView.relationships.every(link => link.mode === 'fk' && link.side === 'from' && !link.conflict));

  const profissionalView = resolveModuleEntity(profissional, agendaIndex, mdm, agendaClinicaRules);
  assert.ok(profissionalView.relationships.every(link => !link.conflict));
});

test('(T3) Consulta is a module table: six columns and a flat details', () => {
  const view = resolveModuleEntity(consulta, agendaIndex, mdm, agendaClinicaRules);

  assert.equal(view.kind, 'entity');
  assert.equal(view.subtype, undefined);
  assert.deepEqual(
    view.columns.map(node => node.id),
    ['id', 'version', 'pacienteId', 'profissionalId', 'scheduledAt', 'status'],
  );
  assert.equal(view.columns.length, 6);
  assert.deepEqual(view.details.map(node => node.id), ['attendanceNote']);
  assert.equal(branch(view, 'attendanceNote').type, 'text');
  assert.equal(branch(view, 'attendanceNote').origin, 'module');
  assert.equal(view.columns.find(node => node.id === 'pacienteId')?.to?.[0], 'Paciente');
  assert.equal(view.columns.find(node => node.id === 'id')?.origin, 'derived');
  assert.equal(view.displayField, 'scheduledAt');
});

test('(T3) a module field that shadows the platform is flagged, it is not silently accepted', () => {
  /*
   * `Paciente.defs.ts` is correct, so the conflict has to be built here: a fixture, not a probe.
   * `name` inside `details.agendaClinica` is exactly what `rule-identity-never-in-namespace` forbids, and
   * `phone` inside `identification` is a module field on a branch the platform owns.
   */
  const shadowed = {
    ...agendaClinicaEntityPaciente,
    record: {
      fields: {
        ...agendaClinicaEntityPaciente.record.fields,
        details: {
          ...agendaClinicaEntityPaciente.record.fields.details,
          fields: {
            ...agendaClinicaEntityPaciente.record.fields.details.fields,
            identification: {
              ...agendaClinicaEntityPaciente.record.fields.details.fields.identification,
              fields: {
                ...agendaClinicaEntityPaciente.record.fields.details.fields.identification.fields,
                phone: { type: 'string', title: 'Telefone' },
              },
            },
            agendaClinica: {
              ...agendaClinicaEntityPaciente.record.fields.details.fields.agendaClinica,
              fields: { name: { type: 'string', title: 'Nome na clínica' } },
            },
          },
        },
      },
    },
  } as unknown as Ns5OntologyEntityV3;

  const view = resolveModuleEntity(shadowed, agendaIndex, mdm, agendaClinicaRules);
  assert.equal(child(branch(view, 'agendaClinica'), 'name').conflict, true, 'identity inside the namespace');
  assert.equal(child(branch(view, 'identification'), 'phone').conflict, true, 'module field on a platform branch');
  // and the untouched neighbours stay clean
  assert.equal(child(branch(view, 'identification'), 'name').conflict, undefined);
  assert.equal(child(branch(view, 'identification'), 'name').origin, 'platform');
});

test('(T3) an id in no catalog is flagged `unresolved`, so the absence is asserted both ways', () => {
  // The three entities resolve everything, which on its own would also be true of a resolver that never
  // sets the flag. This fixture is the other direction.
  const stray = {
    ...agendaClinicaEntityPaciente,
    capabilities: { ...agendaClinicaEntityPaciente.capabilities, 'outroModulo.listar': 'de outro módulo' },
    rules: [...agendaClinicaEntityPaciente.rules, 'regraQueNinguemEscreveu'],
  } as unknown as Ns5OntologyEntityV3;

  const view = resolveModuleEntity(stray, agendaIndex, mdm, agendaClinicaRules);
  assert.equal(view.capabilities.find(item => item.id === 'outroModulo.listar')?.unresolved, true);
  assert.equal(view.rules.find(item => item.id === 'regraQueNinguemEscreveu')?.unresolved, true);
  // and its own namespace is not flagged just for being outside the platform catalog
  assert.equal(view.capabilities.find(item => item.id === 'agendaClinica.listarConsultas')?.unresolved, undefined);
  assert.equal(view.rules.find(item => item.id === 'menorExigeResponsavel')?.unresolved, undefined);
});

test('(T3) a link the module index does not carry is reported, not dropped', () => {
  const orphan = {
    ...agendaClinicaEntityPaciente,
    relationships: {
      ...agendaClinicaEntityPaciente.relationships,
      inventado: {
        relationshipId: 'pacienteNaoExiste',
        to: 'Profissional',
        via: 'Family',
        cardinality: '1:N',
        title: 'Inventado',
      },
    },
  } as unknown as Ns5OntologyEntityV3;

  const view = resolveModuleEntity(orphan, agendaIndex, mdm, agendaClinicaRules);
  assert.match(String(view.relationships.find(link => link.name === 'inventado')?.conflict), /is in no row/);

  // And a far end that disagrees with the index is reported too.
  const crooked = {
    ...agendaClinicaEntityPaciente,
    relationships: {
      ...agendaClinicaEntityPaciente.relationships,
      contatos: { ...agendaClinicaEntityPaciente.relationships.contatos, to: 'Profissional' },
    },
  } as unknown as Ns5OntologyEntityV3;
  assert.match(
    String(resolveModuleEntity(crooked, agendaIndex, mdm, agendaClinicaRules)
      .relationships.find(link => link.name === 'contatos')?.conflict),
    /the entity points at Profissional/,
  );
});

test('(T3) the resolver is pure: the screen imports it in the browser', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'resolveMdmEntity.ts'),
    'utf8',
  );
  // Type-only imports erase; a value import of any of these would reach the browser.
  const valueImports = source.match(/^import (?!type )[^;]+;$/gm) ?? [];
  assert.deepEqual(valueImports, [], `resolveMdmEntity.ts must import nothing at runtime: ${valueImports.join(' | ')}`);
  for (const forbidden of ["'node:", '"node:', '/mdm/module.js', '/mdm/mdmFacade.js', '/mdm/persistence.js', '/mdm/integration.js']) {
    assert.ok(!source.includes(forbidden), `resolveMdmEntity.ts cites ${forbidden}`);
  }
});
