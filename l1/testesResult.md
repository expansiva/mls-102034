# Test Results

## Execution

- Date: 2026-03-19
- Package: `projects/_102034_/l1`
- Commands:

```bash
npm run build
npm run setup:server
npm test
npm run test:integration
```

## Result

- `npm run build`: passed
- `npm run setup:server`: passed
- `npm test`: passed
- `npm run test:integration`: passed
- project-absolute imports `/_102034_/l1/...`: passed with custom post-build rewrite for Node.js runtime
- `details` document contract: passed as structured object in PostgreSQL + DynamoDB
- remote backup tables: passed for document, relationship, audit log, tag, comment, attachment, and number sequence

## Package test summary

- Tests: 54
- Passed: 40
- Failed: 0
- Skipped: 14

## Integration test summary

- Tests: 14
- Passed: 14
- Failed: 0
- Skipped: 0

## Covered scenarios

- memory index runtime supports indexed-column queries across 10 records
- `DataRecordService.create` writes audit and monitoring records
- `DataRecordService.update` uses the provided `before` and records the diff
- `DataRecordService.update` writes monitoring failure and error log on conflict
- `createEntity` deduplicates `Person` by `docType` and `docId`
- privacy-protected `Person` becomes `Inactive` without consent
- `updateEntity` enforces optimistic concurrency
- `promoteProspect` preserves `mdmId` when no duplicate exists
- `promoteProspect` marks `PendingMerge` when duplicate exists
- `mergeEntity` keeps the loser as a tombstone
- `createEntity` stores a realistic person user detail with aliases and addresses
- `createEntity` defaults `companyKind` and `serviceKind`
- `listEntities` supports `orderBy` and `limit` in memory
- `createRelationship` stores compact employee refs in `details.relationshipRefs`
- `createRelationship` stores compact pet refs in `details.relationshipRefs`
- `updateRelationship` removes compact refs when a relationship becomes inactive
- `listRelationships` supports entity filtering through the batched lookup path
- `promoteProspect` migrates relationships and refreshes compact refs on promoted entities
- product, service, location, franchise, group, unit, and attendance relationships generate compact refs
- `Tag` add/remove/find flows work locally and through the BFF
- `Comment` add/edit/remove keeps thread, edit window, and audit trail
- `Attachment` attach/detach keeps local metadata
- `NumberSequence.next` creates and increments formatted values
- `StatusHistory` queries return rows written by core transitions and merge flows
- `POST /execBff` executes routines and returns the response envelope
- `GET /health` returns ok
- message transport uses the same unified protocol
- `execBff` supports user-like person creation, search, tag, comment, and number-sequence flows
- `execBff` supports status-history queries after merge
- monitor snapshot and series BFFs return valid payloads
- PostgreSQL + DynamoDB create entity flow passes with real services
- PostgreSQL + DynamoDB update entity flow passes with real services
- PostgreSQL failed update writes monitoring failure and error log in the real environment
- PostgreSQL + DynamoDB promote prospect flow without duplicate passes with real services
- PostgreSQL + DynamoDB promote prospect flow with duplicate and queue emission passes with real services
- PostgreSQL + DynamoDB merge flow passes with real services
- PostgreSQL + DynamoDB restore flow passes with real services
- PostgreSQL + DynamoDB relationship refs sync to local cache and remote document
- PostgreSQL relationship tables can be rebuilt from DynamoDB backup rows
- PostgreSQL monitor snapshot tracks global BFF executions in the real environment
- PostgreSQL + DynamoDB tag replication passes with real services
- PostgreSQL + DynamoDB comment replication passes with real services
- PostgreSQL + DynamoDB number sequence replication passes with real services
- PostgreSQL status-history query returns the latest merged status in the real environment

## Fixes applied during validation

- replaced the external `microdiff` package in runtime code with a local source implementation
- added `Comment`, `Attachment`, and `NumberSequence` services to the MDM core
- added `StatusHistory` read use cases and BFF routines
- added remote DynamoDB tables and write-behind support for comment, attachment, and number sequence
- made `NumberSequence` follow the effective `ctx.data` runtime instead of forcing PostgreSQL from `.env`
- added explicit runtime mode metadata to `IDataRuntime`
- replaced `tsc-alias` with a custom post-build rewrite for project-absolute imports, and fixed the rewrite to avoid corrupting `dist` output
- updated `.env.local-test.example` and `README.md` with the new remote tables
