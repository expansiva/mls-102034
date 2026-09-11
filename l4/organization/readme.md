# organization — platform level 1

Level-1 ontology of the MDM engine, emitted by `l1/mdm/scripts/emitLevel1Defs.ts`.
Do not edit `ontology/*.defs.ts` by hand. Drift test: `l1/mdm/scripts/emitLevel1Defs.test.ts`.

A client project only stores `l4/organization/registry.defs.ts` (roles, actors, `general` fields).
The solution agents read these defs from `/_102034_/l4/organization/ontology/*`.
