# layer_2.md — generate layer_2_controllers (BFF) from page .defs.ts

**Goal:** transform the `bffCommands` of each page `.defs.ts` (`l2/{module}/{pageId}.defs.ts`)
into BFF handlers + router entries. Layer_2 receives the page request, validates the boundary
input, calls the usecase and shapes the response — nothing else.

## Inputs

1. The page defs: `data.pageDefinition` (pageId, actor, pageInputs[]) and `data.bffCommands[]`:
   `{ commandName, purpose, kind: 'query'|'command'|'mutation', input[], output[],
   readsTables/writesTables (informative), usecaseRefs[], layerContract, rulesApplied[] }`.
2. For each `usecaseRefs` entry: the usecase defs `implementation` block
   (`functionName`, `inputTypeName`, `outputTypeName`, `tsFileRef`) written by the layer_3
   generation (see `layer_3.md`).

## Output file skeleton

`l1/{module}/layer_2_controllers/{pageId}Controller.ts`:

```ts
/// <mls fileReference="_{project}_/l1/{module}/layer_2_controllers/dealDetailController.ts" enhancement="_blank" />
import { ok, AppError, type BffHandler } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import { advanceDealStage, type AdvanceDealStageInput } from '/_{project}_/l1/{module}/layer_3_usecases/advanceDealStage.js';

export const {module}DealDetailAdvanceStageHandler: BffHandler = async ({ request, ctx }) => {
  const input = request.params as AdvanceDealStageInput;
  if (!input.dealId) throw new AppError('VALIDATION_ERROR', 'dealId is required', 400, { field: 'dealId' });
  const result = await advanceDealStage(ctx, input);
  return ok(result);
};
```

Plus one router entry per command:
`key: "{moduleName}.{pageId}.{commandName}"`, `handlerName`, `importPath` (the controller `.js`).

## Rules

- One exported `BffHandler` const per bffCommand; naming
  `{moduleName}{PascalCase(pageId)}{PascalCase(commandName)}Handler`.
- **Import the usecase function AND its input/output types from the usecase file** (use the
  defs `implementation` block). NEVER redeclare interfaces that a usecase already exports; declare
  local types only for fields not covered by any usecaseRef.
- Boundary validation only: required fields, basic shape (`VALIDATION_ERROR`, 400). Business rules
  belong to layer_3 — if you are writing an `if` about state/permissions/limits here, it is in the
  wrong layer.
- **Never touch tables or entities**: no `ctx.data.*`, no imports from `layer_1_external` or
  `layer_4_entities`. (The phase-2 exception — trivial read with zero rules calling layer_4
  directly — is DISABLED until the planning defs mark the command for it explicitly.)
- Response: always `return ok(result)`; errors propagate as `AppError` (the platform serializes
  `BffResponse.error`).
- Identifier inputs follow the page defs `pageInputs` contract (routeParam/session sources are
  resolved by the platform shell; the handler reads them from `request.params`).
- Do not call more than one WRITE usecase per handler — composition of writes is a layer_3
  responsibility (create a usecase for it instead).

## Checks before finishing

1. Every bffCommand has handler + router entry; no handler without a command.
2. `grep ctx.data` returns nothing; no layer_4/layer_1 imports.
3. All usecase types are imported, not redeclared.
4. Router keys unique, pattern `{moduleName}.{pageId}.{commandName}`.
