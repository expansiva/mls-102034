# MDM

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
