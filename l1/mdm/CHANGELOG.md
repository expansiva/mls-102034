# MDM

## 2026-09-16

- ns5_45: `resolveModuleEntity` takes `Ns5RulesAny` — the module rule catalog as the `rules-v2` MAP
  (`ruleId` -> sentence, the shape `l4/ontology/mdm.defs.ts` itself uses) or as the older array. The
  (T3) purity proof forbids every runtime import in `resolveMdmEntity.ts`, so the two forms are read
  by three lines there instead of by `ns5RuleRecord` of `mls-102035/l2/solution/rulesView.ts`, which is
  what every other reader calls; the same test pins the two readings against each other.

## 2026-09-15

- ns5_43 T6: the emitted level-1 catalog is gone. Deleted `l4/organization/`
  (13 subtypes + `index.defs.ts` + `platform.defs.ts` + `readme.md`),
  `scripts/emitLevel1Defs.ts` with its drift test, `defs/level1FromEngine.ts`
  and `defs/platform.ts`. The platform catalog moved verbatim to
  `l4/ontology/platform.defs.ts`; the agents derive the rest from
  `l4/ontology/mdm.defs.ts`. `defs/level1Types.ts` stays: it is the artifact
  grammar the agent side still reads.

## 2026-09-11

- Level-1 ontology is emitted here (`l4/organization/ontology/*.defs.ts`) from
  `defs/ontology.ts`, `module.ts`, `defs/platform.ts` and `mapRelationshipKeys`.
  Drift test: `scripts/emitLevel1Defs.test.ts`. `GuardianOf` is Person → Person | Animal.
