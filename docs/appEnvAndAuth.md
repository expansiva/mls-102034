# appEnv and authentication — the canonical definition

The runtime serves generated apps, and two things about them are decided HERE and nowhere else: which
ENVIRONMENT MODE a published module runs in, and how a request proves WHO is making it. Other projects
point at this file instead of restating it (mls-102033 for the shell, mls-102020 for the generator,
collab-auth for the roles), so there is one definition to change when the policy changes.

## 1. appEnv — the environment mode

`production | homologation | development | presentation`

It lives in `l5/project.json` (`appEnv`) and the **server** reads it at boot. The client never decides the
mode; it only shows the badge. A freshly generated module is born `presentation`.

The same file carries **`projectType`**: `lib | master frontend | master backend | client`. That is the
kind of the project for the workspace `config.json` `projects` block (root + type the VM build
consumes). E10 reads it from each dependency's `l5/project.json` when assembling `projects`; it never
guesses `master frontend`/`master backend`. A generated module is born `client`. A missing field is a
finding, not a silent default that would put the wrong root in the publish.

| appEnv | software | database | authority override (monitor) | seeds / reset | test suite | badge |
|---|---|---|---|---|---|---|
| production | released | production (`DATABASE_URL`) | does not exist (not even the route) | provisioning only | read-only smoke | — |
| homologation | release candidate | **production** | no — it validates real roles | provisioning only | read-only smoke | HOMOLOGATION |
| development | anything | **test** (`DATABASE_URL_TEST`) | yes | yes | full | DEVELOPMENT |
| presentation | anything | **test** (curated seeds) | yes | yes | full | PRESENTATION |

The test database is a separate database in the SAME Postgres, with the same bootstrap and the same
`mls<project>_` namespacing. When a test mode boots without its env, that is a **legible boot error** — it
must never fall back to the production database.

**Seeds: provisioning yes, re-seed no.** Seeds run in ANY mode while the module's tables are being
CREATED — that first bootstrap/publish is how a generated app is born usable, in production too. What
`production` and `homologation` forbid is RE-seeding or resetting tables that already hold data;
`development` and `presentation` reset freely. The runner-channel defence (`refuseTestWrite`) is about
requests whose `source` is `test`, and provisioning does not travel through it.

**Nothing manual per project.** For generated projects the whole per-project chain flows through the
publish/bootstrap: creating the tables in the database the mode selects, plus the provisioning seeds. A
test mode pointed at a database nobody created provisions it (only the database; only in a test mode).
The single manual, once-per-server step is giving the runtime the `DATABASE_URL_TEST` credentials.

**Two names on purpose.** `env.runtimeMode` (`postgres` | `memory`) is the persistence ENGINE, not the
environment. And in code this per-project mode is `ProjectMode`, not `appEnv`: `AppEnv.appEnv` already
means the deployment environment of the SERVER (`development | staging | production`, from `APP_ENV`), and
one server hosts many projects, each with its own mode. The key in `l5/project.json` and in the boot
config stays `appEnv`; only the code-level name differs, and none of the three is merged into another.

### Precedence (project.json vs APP_ENV vs `/monitor/tests`)

| source | name in code | values | wins for |
|---|---|---|---|
| `l5/project.json` `appEnv` | `ProjectMode` (`readProjectMode`) | production \| homologation \| development \| presentation | database (`DATABASE_URL` vs `_TEST`), `refuseTestWrite`, shell badge, authority override, **the `appEnv` field of `/monitor/tests`** |
| process `APP_ENV` | `AppEnv.appEnv` (`readAppEnv`) | development \| staging \| production | server storage/engine, not the project |

`APP_ENV` **never** overrides `project.json`. A VM whose server is `APP_ENV=production` can still host a module whose `project.json` says `presentation` (curated test DB, full suite). The first petShop test run reported `"appEnv": "production"` because the runner printed the server value; it now prints `appEnv` from `readProjectMode` (`appEnvSource: "l5/project.json"` when the file declared a valid mode, else `"default"`) and `serverAppEnv` from `APP_ENV`.

## 1b. Object storage — one bucket per project

Business attachments (`mdm_attachment`) are files of a **client project**. Isolation is a bucket
named with that project's id, not a folder in a shared bucket:

| env | default | meaning |
|---|---|---|
| `S3_BUCKET` | `collab-{projectId}` | **Permanent** bucket. `{projectId}` is substituted. Empty string forces local disk. |
| `S3_BUCKET_TMP` | `collab-{projectId}-tmp` | Optional **tmp** bucket for ephemeral artifacts (LLM images that may expire). Empty disables it. **MDM attachments never use it.** |
| `ATTACHMENT_MAX_BYTES` | `8388608` (8 MiB) | Rejected at the dedicated upload route, before S3. |
| `ATTACHMENT_ALLOWED_MIME` | `image/jpeg,image/png,image/webp,image/gif,application/pdf` | Same: rejected before S3. |

AWS credentials are the ones already on the runtime (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`, `AWS_SESSION_TOKEN`). Missing credentials, a missing `PROJECT_ID` when the pattern
needs it, or an empty `S3_BUCKET` → `storageProvider: 'local'` (disk of the VM) and the reason is
named, never a generic S3 crash.

The object **key** of a business attachment is
`attachments/{projectId}/{entityType}/{entityId}/{id}-{fileName}` — the permanent prefix. The
collab-messages convention `images/tmp/…` + `30d` is for artifacts that a lifecycle rule may
delete; a pet photo is not that. The only thing stored in `mdm_attachment.storageKey` is this key.
A presigned GET URL is derived at read time (`GET /attachments/:id/url`, default 3600s) and is
**never written to the database**.

Bytes do not travel through `/execBff` (JSON, traced, already truncated). They go
`POST /attachments` as base64 on that dedicated route, then `ctx.mdm.attachment.attach`.
`l3/assets` is unchanged: static app images stay static app images.

**Runner rule** (the lesson of a test run that wrote junk into production): the full suite
(create/update/delete) runs ONLY in `development` and `presentation`. Two independent defences — the runner
checks the target's appEnv, AND the server refuses a write whose `source` is `test` when the appEnv is
`production` or `homologation`.

## 2. Authenticating `/execBff`

`POST /execBff` is the single door of a generated app: every action of every screen posts there, so
authenticating this route authenticates the whole app.

- **Collab-auth JWT, verified on the server** — jose v6, `createRemoteJWKSet` + `jwtVerify`, issuer
  `https://auth.collab.codes`, everything overridable by env. Same verifier the rest of the platform uses
  (collab-messages / collab-billing / cbe), including the `grace_until` tolerance.
- **Transport: the httpOnly `cauth` cookie**, which the runtime login already writes. This is not a
  preference — the browser CANNOT send a header it cannot read, and taking the token out of httpOnly to
  make that possible would weaken the session. `Authorization: Bearer` is the secondary path, for callers
  that do hold a token (server-to-server, the test runner). Never in a query string or a URL, never
  exposed to JS.
- **Staged activation** through `BFF_JWT_ENABLED` (default `false`): the verifier runs and reports who
  WOULD have been refused, so the flip is a measured decision and the same env is the rollback afterwards.
- Implemented in `l1/server/layer_1_external/auth/bffAuth.ts`: the session comes only from verified claims
  (they reach `execBff` as `verifiedUserId`/`verifiedEmail`), `requestMeta.userId` is overwritten with
  `claims.email`, and the shell redirects to the login on a 401.

**Identity in telemetry** is the user's EMAIL (`meta.userId`), because a display name is not unique. It is
telemetry only: nothing authorizes by it.

## 3. Authority — the roles

- Format `<moduleId>:<actorId>` (`petShop:admin`, `buildFlowFsm:projectManager`) — the extension of the
  platform's own pattern (`sites:admin`, `collab-llm:operator`) and the shape the generated code already
  expects (`enforceActors`, and the `` `${module}:${actor}` `` fallback of the backend generator; E3 emits
  `<module>:<authority>`).
- Authorities travel in the access token claims; validation is offline; a role change takes effect on the
  refresh.
- Managed in collab-auth / collab-admin with **dynamic** module roles (arbitrary `<module>:<actor>`
  strings). Publishing a module REGISTERS its authority catalogue (actor + title + description, derived
  from E3) so they can be assigned from a list instead of typed.
- An authenticated user with no authority in the module gets a legible **403** (once enforcement is on).
- The shell's menu is filtered by authority (`navigation[].actors` ∩ claims).

**Phases.** 1 — authenticate the route (done, behind the flag). 2 — authorities in the claims and
deny-by-default in `enforceActors`, behind `BFF_ACTORS_ENFORCED`; today an empty scope is permissive, which
means the actor gate is inert for real HTTP traffic. 3 — fine data scope ("which records are theirs")
through the party / `platformUserId` link, with the MDM wave.

**Authority override** (the "presentation mode"): server-side, per authenticated user, set from the
monitor, allowed ONLY in `development` and `presentation`. The audit always records the real `sub` plus the
authorities in force. In `production` the route does not exist.
