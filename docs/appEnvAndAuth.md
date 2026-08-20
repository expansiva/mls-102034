# appEnv and authentication — the canonical definition

The runtime serves generated apps, and two things about them are decided HERE and nowhere else: which
ENVIRONMENT MODE a published module runs in, and how a request proves WHO is making it. Other projects
point at this file instead of restating it (mls-102033 for the shell, mls-102020 for the generator,
collab-auth for the roles), so there is one definition to change when the policy changes.

## 1. appEnv — the environment mode

`production | homologation | development | presentation`

It lives in `l5/project.json` (`appEnv`) and the **server** reads it at boot. The client never decides the
mode; it only shows the badge. A freshly generated module is born `presentation`.

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
