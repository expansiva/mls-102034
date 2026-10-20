/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServer.ts" enhancement="_blank" />
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { getFrontendAppByBasePath, getFrontendAppRegistrations, getAppPublicRootDir, getAppAssetRootDirs } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';
import { injectFaviconLink, resolveAppFaviconHref } from '/_102034_/l1/server/layer_1_external/frontend/faviconHtml.js';
import { readProjectsConfig, resolveWebDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { classifyProjectAssetUrl, HASHED_SHARED_JS_PATH } from '/_102034_/l1/server/layer_1_external/transport/http/classifyProjectAssetUrl.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { applyVerifiedEmailToSession, createDefaultRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { initializeOrganizationForProcess } from '/_102034_/l1/mdm/layer_3_usecases/organizationBootstrap.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  claimAuthorities, isActorEnforcementOn, isBffAuthEnforced, moduleAuthorities, resolveBffSession, verifyAccessToken,
  type BffAuthOutcome,
} from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { isAlphaAllAuthorities } from '/_102034_/l1/server/layer_1_external/config/alphaAuthorities.js';
import { readProjectMode, type ProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import {
  effectiveAuthorities, readAuthorityOverride, refuseOverride, writeAuthorityOverride,
  type AuthorityOverride,
} from '/_102034_/l1/server/layer_1_external/auth/authorityOverride.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import { resolveClientProjectId } from '/_102034_/l1/server/layer_1_external/cbe/cbeDesenv.js';
import { getCompiledProject, getProjectsBaseDir } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledLocal.js';
import { listServableProjectIds } from '/_102034_/l1/server/layer_1_external/cbe/cbeLogin.js';
import { applyDraftExecBff } from '/_102034_/l1/server/layer_1_external/transport/http/draftProxy.js';
import { getLatestJson, initCbeLatestJson } from '/_102034_/l1/server/layer_1_external/cbe/cbeLatestJson.js';
import { getRunningRelease } from '/_102034_/l1/server/layer_1_external/cbe/cbeRelease.js';
import { registerMsgProxy } from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';
import { registerGitRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/gitHttp.js';
import { registerSessionRegistrationRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/sessionRegistration.js';
import { registerLocalTestSessionRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/localTestSessionHttp.js';
import { registerWorkflowWakeRoutes } from '/_102034_/l1/server/layer_1_external/transport/http/workflowWake.js';
import { WorkflowWakeInboxLoop } from '/_102034_/l1/workflow/wakeLoop.js';
import { OnboardingConfigError, readOnboardingConfig, resolveOrganizationBinding } from '/_102034_/l1/server/layer_1_external/config/onboardingConfig.js';
import { isPersonAccessComplete } from '/_102034_/l1/mdm/layer_3_usecases/mdmSupport.js';
import { normalizeRegistrationEmail } from '/_102034_/l1/mdm/layer_3_usecases/registrationCandidates.js';
import { readRegistrationStore } from '/_102034_/l1/mdm/layer_3_usecases/registrationStore.js';
import {
  isAccessRequest, isRequestIndex, personByLogin, requestIndexKey, requestRecordKey,
} from '/_102034_/l1/mdm/layer_3_usecases/selfRegistration.js';
import type { ProjectOnboardingConfig } from '/_102029_/l2/runtimeConfigTypes.js';
import { buildNewReleaseQaHtml, canServeNewReleaseQa, extractNewReleaseQaLitImportMap, newReleaseQaProjectHint } from '/_102034_/l1/server/layer_1_external/transport/http/newReleaseQaRoute.js';
import {
  handleAttachmentHttp, isAttachmentHttpPath,
} from '/_102034_/l1/server/layer_1_external/storage/attachmentHttp.js';
import { getCompiledStaticFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledStatic.js';
import { localAliasCandidates } from '/_102034_/l1/server/layer_1_external/cbe/cbeLocalAlias.js';
import { WriteBehindWorker } from '/_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.js';
import { ModuleTickLoop, MODULE_TICK_INTERVAL_MS } from '/_102034_/l1/server/layer_2_application/tick/moduleTick.js';
import {
  createRuntimeMetricsCollector,
  loadRuntimeMetricSamples,
  parseRuntimeMetricsQuery,
} from '/_102034_/l1/monitor/layer_3_usecases/runtimeMetricsUsecases.js';
import type { BffRequest, FrontendAppRegistration, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

/** Session JSON projection. The IdP `sub` stays `userId`; this is only the MDM person. */
export type SessionInfoPerson = { mdmId: string };

export type SessionOnboardingStatus = 'ready' | 'incomplete' | 'pending' | 'unregistered' | 'unavailable';

export type SessionInfoOnboarding = {
  status: SessionOnboardingStatus;
  entryPath: string;
  moduleBasePath: string;
  requestId?: string;
};

export type SessionInfoCompany = { mdmId: string };

/** Entry already checked against the client module. `organizationKey` null means the index cannot be read. */
export type SessionOnboardingSource = {
  entry: { entryPath: string; moduleBasePath: string };
  organizationKey: string | null;
  companyMdmId?: string | null;
};

type ClientModuleRoutes = Pick<FrontendAppRegistration, 'projectId' | 'appId' | 'basePath' | 'routes'>;

/**
 * Entry of the configured client module. Throws a readable error for an external URL,
 * a missing module, or a path that is not a route or alias of that module.
 */
export function resolveClientOnboardingEntry(
  onboarding: Pick<ProjectOnboardingConfig, 'moduleId' | 'entryPath'>,
  clientProjectId: string,
  apps: readonly ClientModuleRoutes[],
): { entryPath: string; moduleBasePath: string } {
  const entryPath = onboarding.entryPath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(entryPath) || entryPath.includes('//') || !entryPath.startsWith('/')) {
    throw new OnboardingConfigError(`onboarding.entryPath rejects an external origin: ${entryPath}`);
  }
  const module = apps.find((app) => app.projectId === clientProjectId && app.appId === onboarding.moduleId);
  if (!module) {
    throw new OnboardingConfigError(
      `onboarding.moduleId '${onboarding.moduleId}' is not a registered module of client ${clientProjectId}`,
    );
  }
  const paths = module.routes.flatMap((route) => [route.path, ...(route.aliases ?? [])]);
  if (!paths.includes(entryPath)) {
    throw new OnboardingConfigError(
      `onboarding.entryPath '${entryPath}' is not a route of client module '${onboarding.moduleId}'`,
    );
  }
  return { entryPath, moduleBasePath: module.basePath };
}

const WRITE_BEHIND_INTERVAL_MS = 5000;

function refreshedAuthCookie(token: string): string {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  return `cauth=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly; Expires=${expires}`;
}

export function getContentType(filePath: string) {
  // `extname('.wav')` is '' (dotfile with no extension); T4 passes the ext itself.
  const ext = extname(filePath) || filePath;
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.ts':
    case '.tsx':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    // Binary asset payloads (seed images live in l3/<module>/assets). Without these a served .webp
    // would go out as `text/plain` and the browser would refuse to paint it (bugimage.md).
    case '.webp':
      return 'image/webp';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.mp4':
      return 'video/mp4';
    case '.pdf':
      return 'application/pdf';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function readStaticFile(filePath: string) {
  return {
    body: readFileSync(filePath),
    contentType: getContentType(filePath),
  };
}

async function buildBootConfigScript(app: FrontendAppRegistration) {
  if (!app.routes.length) {
    return '';
  }

  let onboarding: { entryPath: string; moduleBasePath: string } | undefined;
  try {
    const projects = readProjectsConfig();
    const onboardingConfig = readOnboardingConfig(projects);
    // redirect false keeps provisioning and session state, and does not arm the entry script.
    if (onboardingConfig && onboardingConfig.redirect !== false) {
      onboarding = resolveClientOnboardingEntry(
        onboardingConfig,
        projects.defaultProjectId,
        await getFrontendAppRegistrations(),
      );
    }
  } catch (error) {
    if (error instanceof OnboardingConfigError) throw error;
  }

  const payload = JSON.stringify({
    projectId: app.projectId,
    // O projeto do cliente, sempre — mesmo servindo um modulo de plataforma. Quem quer saber
    // "de quem e' este modulo" continua lendo `projectId`.
    clientProjectId: resolveClientProjectId(),
    moduleId: app.appId,
    basePath: app.basePath,
    shellMode: app.shellMode,
    device: app.device ?? 'desktop',
    languages: app.languages ?? [],
    designSystems: app.designSystems ?? [],
    routes: app.routes,
    headerEntrypoint: app.headerRenderer?.entrypoint,
    headerTag: app.headerRenderer?.tag,
    asideEntrypoint: app.asideRenderer?.entrypoint,
    asideTag: app.asideRenderer?.tag,
    pageTitle: app.pageTitle,
    navigation: app.navigation ?? [],
    moduleLinks: app.moduleLinks ?? [],
    layout: app.layout,
    clientShell: app.clientShell,
    // The mode the SERVER resolved. The client only shows the badge with it — it never decides the mode
    // (that is deployment config, read from the project's l5/project.json at boot).
    appEnv: readProjectMode(app.projectId),
    ...(onboarding ? { onboarding } : {}),
  }).replace(/</gu, '\\u003c');

  // window.latest mirrors the studio index.html (versions from the central
  // latest.json — see cbeLatestJson): the client loads versioned libs with it.
  const latestJson = getLatestJson();
  const latestScript = latestJson ? `window.latest=${latestJson.replace(/</gu, '\\u003c')};` : '';
  const fechoScript = `window.collabFecho=${buildCollabFechoJson()};`;
  return `<script>window.collabBoot=${payload};${latestScript}${fechoScript}</script>`;
}

// Closure of this app plus each project's lastModified, so the page can drop
// only the cache entries of projects that changed. Same `<` escape as latest.
function buildCollabFechoJson(): string {
  const fecho: Record<string, string> = {};
  for (const id of listServableProjectIds()) {
    const lastModified = getCompiledProject(id)?.lastModified;
    if (lastModified) fecho[String(id)] = lastModified;
  }
  return JSON.stringify(fecho).replace(/</gu, '\\u003c');
}

async function injectBootConfig(html: string, app: FrontendAppRegistration) {
  const faviconHref = app.faviconHref ?? resolveAppFaviconHref(undefined).href;
  const withIcon = injectFaviconLink(html, faviconHref);
  const bootScript = await buildBootConfigScript(app);
  if (!bootScript) {
    return withIcon;
  }

  if (withIcon.includes('</head>')) {
    return withIcon.replace('</head>', `  ${bootScript}\n  </head>`);
  }

  if (withIcon.includes('<body>')) {
    return withIcon.replace('<body>', `<body>\n    ${bootScript}`);
  }

  return `${bootScript}\n${withIcon}`;
}

async function readAppHtml(filePath: string, app: FrontendAppRegistration) {
  return {
    body: Buffer.from(await injectBootConfig(readFileSync(filePath, 'utf8'), app), 'utf8'),
    contentType: 'text/html; charset=utf-8',
  };
}

function tryReadProjectAsset(urlPath: string) {
  const kind = classifyProjectAssetUrl(urlPath);
  if (kind !== 'static' && kind !== 'libs') {
    return null;
  }

  const path = urlPath.replace(/\?.*$/u, '');
  if (kind === 'libs') {
    const filePath = resolveWebDistPath(`.${path}`);
    if (!existsSync(filePath)) {
      return null;
    }
    return readStaticFile(filePath);
  }

  const match = /^\/(_\d+_)\/(l2|l3)\/(.+)$/u.exec(path);
  if (!match) {
    return null;
  }

  const [, projectSegment, layer, remainder] = match;
  const layerRoot = resolveWebDistPath(`./${projectSegment}/${layer}`);
  const assetPath = normalize(join(layerRoot, remainder));
  // Containment: `remainder` comes from the URL, so `..` must never escape the layer root.
  if (!assetPath.startsWith(layerRoot) || !existsSync(assetPath)) {
    return null;
  }

  return readStaticFile(assetPath);
}

async function tryReadAppFile(urlPath: string) {
  const app = await getFrontendAppByBasePath(urlPath);
  if (!app) {
    return null;
  }

  const publicRootDir = getAppPublicRootDir(app);
  const relativePath = urlPath.slice(app.basePath.length).replace(/^\/+/u, '');
  const hasExplicitFile = relativePath.length > 0 && extname(relativePath) !== '';
  if (hasExplicitFile) {
    // The shell's own directory first (index.html and anything published beside it), then the app's
    // ASSET ROOTS. The latter is what makes a seed image reachable: the BFF returns
    // `/cafeFlow/assets/seed/MenuItem/x.webp`, whose bytes live in `_<project>_/l3/cafeFlow/assets/...`,
    // a directory the shell root does not contain. Before this, any such request silently fell through
    // to `readAppHtml` below and the browser received the SPA shell with HTTP 200 (bugimage.md) — the
    // most confusing possible failure, since nothing 404s.
    for (const root of [publicRootDir, ...getAppAssetRootDirs(app)]) {
      const filePath = normalize(join(root, relativePath));
      // Containment check: `relativePath` comes from the URL, so `..` must never escape the root.
      if (!filePath.startsWith(root) || !existsSync(filePath)) continue;
      return extname(filePath) === '.html' ? await readAppHtml(filePath, app) : readStaticFile(filePath);
    }
  }

  return readAppHtml(app.indexHtmlPath, app);
}

async function resolveDefaultFrontendLocation() {
  const config = readProjectsConfig();
  const apps = await getFrontendAppRegistrations();
  const preferredApp = apps.find((app) => app.projectId === config.defaultProjectId) ?? apps[0];
  return preferredApp ? `${preferredApp.basePath}/index.html` : '/health';
}

/**
 * Body of `GET /session/info`. Authorities come from `claimAuthorities` (top-level ∪
 * `active_org.teams[].roles`); the unused `authorities` field is not emitted.
 */
export function sessionInfoBody(
  session: BffAuthOutcome,
  mode: ProjectMode,
  override: AuthorityOverride | null,
  person: SessionInfoPerson | null = null,
  gate?: { company?: SessionInfoCompany | null; onboarding?: SessionInfoOnboarding },
) {
  const real = claimAuthorities(session.claims);
  const effective = effectiveAuthorities(real, override);
  return {
    authenticated: !!session.claims,
    email: session.claims?.email ?? null,
    // Standard OIDC profile claims, forwarded as-is so the client chrome (the header avatar) can
    // show who is logged in. Null when the IdP does not send them — the caller falls back to initials.
    name: (session.claims as { name?: unknown } | undefined)?.name ?? null,
    picture: (session.claims as { picture?: unknown } | undefined)?.picture ?? null,
    userId: session.claims?.sub ?? null,
    person,
    allAuthorities: effective.authorities,
    realAuthorities: effective.real,
    overridden: effective.overridden,
    canOverride: !refuseOverride(mode),
    appEnv: mode,
    expiresAt: typeof session.claims?.exp === 'number' ? new Date(session.claims.exp * 1000).toISOString() : null,
    enforcement: { authentication: isBffAuthEnforced(), actors: isActorEnforcementOn() },
    reason: session.reason,
    ...(session.source === 'local-test' ? { sessionSource: 'local-test' as const } : {}),
    ...(gate && Object.prototype.hasOwnProperty.call(gate, 'company') ? { company: gate.company } : {}),
    ...(gate?.onboarding ? { onboarding: gate.onboarding } : {}),
  };
}

async function loadLiveOnboarding(): Promise<SessionOnboardingSource | null> {
  let projects;
  try {
    projects = readProjectsConfig();
  } catch {
    return null;
  }
  const onboarding = readOnboardingConfig(projects);
  if (!onboarding) return null;
  const entry = resolveClientOnboardingEntry(
    onboarding,
    projects.defaultProjectId,
    await getFrontendAppRegistrations(),
  );
  let organizationKey: string | null = null;
  try {
    organizationKey = resolveOrganizationBinding(projects)?.key ?? null;
  } catch {
    console.error('session/info organization unresolved: lookup-failed');
    organizationKey = null;
  }
  return { entry, organizationKey };
}

/** Read the caller's request index. Missing index is null. A broken index throws. */
async function readOwnRequestId(ctx: RequestContext, organizationKey: string, email: string): Promise<string | null> {
  const normalized = normalizeRegistrationEmail(email);
  const indexed = await readRegistrationStore(ctx, requestIndexKey(organizationKey, normalized));
  if (!indexed) return null;
  const requestId = isRequestIndex(indexed, organizationKey, normalized);
  const stored = await readRegistrationStore(ctx, requestRecordKey(requestId));
  if (!stored) {
    throw new AppError('ACCESS_REQUEST_INVALID', 'access request index points at a missing record', 500, { requestId });
  }
  return isAccessRequest(stored, requestId, organizationKey, normalized).requestId;
}

/**
 * Same MDM resolution the BFF uses (`applyVerifiedEmailToSession` on the verified e-mail only).
 * A failed read keeps the rest of the session and reports no person — never the IdP sub.
 */
export async function resolveSessionInfoBody(
  ctx: RequestContext,
  session: BffAuthOutcome,
  mode: ProjectMode,
  override: AuthorityOverride | null,
  gate?: SessionOnboardingSource | null,
) {
  const email = session.claims?.email;
  const companyId = ctx.sessionContext.activeCompanyId || null;
  let person: SessionInfoPerson | null = null;
  let lookupFailed = false;
  if (email) {
    try {
      const resolved = await applyVerifiedEmailToSession(ctx, ctx.sessionContext, email);
      if (resolved.person?.mdmId) person = { mdmId: resolved.person.mdmId };
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'lookup-failed';
      console.error(`session/info person unresolved: ${code}`);
      person = null;
      lookupFailed = true;
    }
  }
  const live = gate === undefined ? await loadLiveOnboarding() : gate;
  if (!session.claims) return sessionInfoBody(session, mode, override, person);
  if (!live) {
    if (!companyId) return sessionInfoBody(session, mode, override, person);
    return sessionInfoBody(session, mode, override, person, { company: { mdmId: companyId } });
  }

  let status: SessionOnboardingStatus;
  let requestId: string | undefined;
  if (lookupFailed) {
    person = null;
    status = 'unavailable';
  } else if (person && email) {
    try {
      const detail = await personByLogin(ctx, email);
      if (!detail || detail.mdmId !== person.mdmId) {
        person = null;
        status = 'unavailable';
        console.error('session/info person unresolved: lookup-failed');
      } else {
        status = isPersonAccessComplete(detail) ? 'ready' : 'incomplete';
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'lookup-failed';
      console.error(`session/info person unresolved: ${code}`);
      person = null;
      status = 'unavailable';
    }
  } else if (!email || !live.organizationKey) {
    status = email ? 'unavailable' : 'unregistered';
  } else {
    try {
      const found = await readOwnRequestId(ctx, live.organizationKey, email);
      if (found) {
        status = 'pending';
        requestId = found;
      } else {
        status = 'unregistered';
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'lookup-failed';
      console.error(`session/info person unresolved: ${code}`);
      status = 'unavailable';
    }
  }

  const onboarding: SessionInfoOnboarding = {
    status,
    entryPath: live.entry.entryPath,
    moduleBasePath: live.entry.moduleBasePath,
  };
  if (requestId) onboarding.requestId = requestId;
  return sessionInfoBody(session, mode, override, person, {
    company: companyId ? { mdmId: companyId } : null,
    onboarding,
  });
}

export function buildHttpServer() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));
  // cbe-compatible endpoints (login + mls lib assets) for the runtime VM.
  // Registered before the catch-all GET /* so /libs/* wins the route match.
  initCbeLatestJson();
  registerCbeRoutes(app);
  // Same-origin proxy to the collab-messages backend (pm2 "msg" app).
  registerMsgProxy(app);
  // The git door (gb50): `git push https://<vm>/git/mls-<id>.git` with a collab-auth JWT. Also before
  // the catch-all GET /*, so a clone is never answered with the SPA shell. Additive: no existing route
  // changes behaviour, and `COLLAB_GIT_HTTP_ENABLED=false` removes it entirely.
  registerGitRoutes(app, verifyAccessToken);
  app.get('/__qa/new-release', async (request, reply) => {
    const mode = readProjectMode(readAppEnv().projectId);
    if (!canServeNewReleaseQa({
      mode,
      host: String(request.headers.host ?? ''),
      remoteAddress: request.ip,
    })) {
      reply.status(404);
      return { statusCode: 404, msg: 'Not found' };
    }
    const shell = (await getFrontendAppRegistrations())[0];
    if (!shell) throw new Error('QA shell unavailable');
    const litImportMap = extractNewReleaseQaLitImportMap(readFileSync(shell.indexHtmlPath, 'utf8'));
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return buildNewReleaseQaHtml(
      getRunningRelease()?.id ?? 'development',
      newReleaseQaProjectHint(request.url),
      litImportMap,
    );
  });
  app.get('/', async (_request, reply) => {
    reply.redirect(await resolveDefaultFrontendLocation());
  });
  // The single door of a generated app: every action of every screen posts here, so authenticating THIS
  // route authenticates the whole app. The headers travel into the handler because the identity rides in
  // the **httpOnly `cauth` cookie** the runtime login writes — JS never sees that token, so the page
  // cannot send a header and does not need to: a same-origin request carries the cookie by itself
  // (bffAuth.resolveBffSession). Enforcement is off by default (`BFF_JWT_ENABLED`), stage 1: verify and
  // report, never lock out an app that is already published.
  // Binary attachments: dedicated routes, never `/execBff`. Body limit is the base64 of ATTACHMENT_MAX_BYTES.
  const attachmentBodyLimit = Math.max(12 * 1024 * 1024, Math.ceil(readAppEnv().attachmentMaxBytes * 1.4) + 4096);
  app.post('/attachments', { bodyLimit: attachmentBodyLimit }, async (request, reply) => {
    const result = await handleAttachmentHttp('POST', '/attachments', request.body, undefined, request.headers);
    reply.status(result.statusCode);
    if (result.headers) reply.headers(result.headers);
    return result.body;
  });
  app.get('/attachments/:id/url', async (request, reply) => {
    const result = await handleAttachmentHttp('GET', request.url, undefined, undefined, request.headers);
    reply.status(result.statusCode);
    if (result.headers) reply.headers(result.headers);
    return result.body;
  });
  app.get('/attachments/:id/file', async (request, reply) => {
    const result = await handleAttachmentHttp('GET', request.url, undefined, undefined, request.headers);
    reply.status(result.statusCode);
    if (result.headers) reply.headers(result.headers);
    return result.body;
  });
  registerWorkflowWakeRoutes(app);
  app.post('/execBff', async (request, reply) => {
    const draft = await applyDraftExecBff({
      request,
      reply,
      base: getProjectsBaseDir(),
      clientProjectId: resolveClientProjectId(),
      resolveSession: () => resolveBffSession(request.headers),
      refreshedAuthCookie,
    });
    if (draft.handled) return;
    const result = await handleHttpRequest('POST', '/execBff', request.body, undefined, request.headers);
    reply.status(result.statusCode);
    if (result.headers?.['set-cookie']) reply.header('set-cookie', result.headers['set-cookie']);
    if (result.headers?.['content-type']) {
      reply.type(result.headers['content-type']);
    }
    return result.body;
  });
  /**
   * Who am I, and where am I? One authenticated answer for both consumers that need it: the shell (to
   * filter the menu by authority and show the environment badge) and the monitor's Session card.
   *
   * A GET, not a routine of `/execBff`: it belongs to no module, and the shell needs it before any module
   * is loaded. It NEVER echoes the token — only the identity, the mode, and the user's own authorities.
   * Authorities come from `claimAuthorities` (top-level ∪ `active_org.teams[].roles`).
   */
  app.get('/session/info', async (request, reply) => {
    const session = await resolveBffSession(request.headers);
    reply.header('cache-control', 'no-store');
    if (session.newAccessToken) reply.header('set-cookie', refreshedAuthCookie(session.newAccessToken));
    const mode = readProjectMode(readAppEnv().projectId);
    const ctx = createDefaultRequestContext();
    const override = session.claims && !refuseOverride(mode)
      ? await readAuthorityOverride(ctx, session.claims.sub)
      : null;
    return resolveSessionInfoBody(ctx, session, mode, override);
  });
  /**
   * Act as another authority ("presentation mode"), or clear it with an empty list.
   *
   * Refused outside `development`/`presentation` — and refused HERE as well as inside
   * `writeAuthorityOverride`, because this is the one endpoint that can make a user look like someone
   * else. The choice is per authenticated user and lives server-side; the audit keeps the real identity.
   */
  app.post('/session/authority-override', async (request, reply) => {
    const session = await resolveBffSession(request.headers);
    const mode = readProjectMode(readAppEnv().projectId);
    const refusal = refuseOverride(mode);
    if (refusal) {
      reply.status(403);
      return { ok: false, data: null, error: { code: 'OVERRIDE_NOT_ALLOWED', message: refusal } };
    }
    if (!session.claims) {
      reply.status(401);
      return { ok: false, data: null, error: { code: 'UNAUTHENTICATED', message: 'Sign in before switching authority.' } };
    }
    const body = (request.body ?? {}) as { authorities?: unknown };
    const requested = Array.isArray(body.authorities)
      ? body.authorities.filter((value): value is string => typeof value === 'string')
      : [];
    try {
      const override = await writeAuthorityOverride(createDefaultRequestContext(), mode, session.claims.sub, requested);
      return { ok: true, data: { override }, error: null };
    } catch (error) {
      const status = error instanceof AppError ? error.statusCode : 500;
      reply.status(status);
      return {
        ok: false,
        data: null,
        error: {
          code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'override failed',
        },
      };
    }
  });
  // Optional platform doors. They compose the session `/session/info` already resolved.
  // Registered before the catch-all so a missing page is not the SPA shell.
  if (readOnboardingConfig(readProjectsConfig())) {
    registerSessionRegistrationRoutes(app, { refreshedAuthCookie });
  }
  // Lima bench selector. The handler answers 404 when the bench is off or the host is not local,
  // and it is registered before the SPA catch-all so that 404 is real.
  registerLocalTestSessionRoutes(app);
  app.get('/*', async (request, reply) => {
    const result = await handleHttpRequest('GET', request.url);
    const etag = result.headers?.etag;
    if (result.statusCode === 200 && typeof etag === 'string') {
      const clientETag = ((request.headers['if-none-match'] as string | undefined) ?? '').replace(/^W\//u, '').replaceAll('"', '');
      const serverETag = etag.replaceAll('"', '');
      if (clientETag && clientETag === serverETag) {
        reply.status(304);
        return null;
      }
    }
    reply.status(result.statusCode);
    if (result.headers) {
      reply.headers(result.headers);
    }
    return result.body;
  });

  return app;
}

export async function handleHttpRequest(
  method: string,
  url: string,
  body?: unknown,
  ctx?: RequestContext,
  headers?: Record<string, string | string[] | undefined>,
) {
  if (method === 'GET' && url === '/') {
    const defaultFrontendLocation = await resolveDefaultFrontendLocation();
    return {
      statusCode: 302,
      body: '',
      headers: {
        location: defaultFrontendLocation,
      },
    };
  }

  if (method === 'GET' && url === '/health') {
    return {
      statusCode: 200,
      body: { ok: true },
    };
  }

  if (isAttachmentHttpPath(method, url)) {
    return handleAttachmentHttp(method, url, body, ctx, headers);
  }

  if (method === 'GET' && new URL(url, 'http://runtime.local').pathname === '/monitor/runtime-metrics') {
    try {
      const config = readProjectsConfig();
      const query = parseRuntimeMetricsQuery(url);
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: await loadRuntimeMetricSamples({
            ...query,
            defaultProjectId: config.defaultProjectId,
          }),
          error: null,
        },
      };
    } catch (error) {
      console.error('[runtimeMetrics] endpoint failed:', error);
      return {
        statusCode: 503,
        body: {
          ok: false,
          data: null,
          error: {
            code: 'RUNTIME_METRICS_UNAVAILABLE',
            message: 'Runtime metrics are temporarily unavailable',
          },
        },
      };
    }
  }

  if (method === 'GET') {
    if (url.startsWith('/local/')) {
      for (const candidate of localAliasCandidates(url)) {
        const compiled = getCompiledStaticFile(candidate);
        if (compiled) {
          return {
            statusCode: 200,
            body: compiled.content,
            headers: {
              'content-type': compiled.contentType,
              'cache-control': 'no-cache',
              etag: `"${compiled.eTag}"`,
            },
          };
        }
      }
      return {
        statusCode: 404,
        body: {
          ok: false,
          data: null,
          error: { code: 'NOT_FOUND', message: 'Route not found' },
        },
      };
    }

    const kind = classifyProjectAssetUrl(url);
    if (kind === 'module') {
      const compiled = getCompiledStaticFile(url);
      if (!compiled) {
        return {
          statusCode: 404,
          body: {
            ok: false,
            data: null,
            error: { code: 'NOT_FOUND', message: 'Route not found' },
          },
        };
      }
      return {
        statusCode: 200,
        body: compiled.content,
        headers: {
          'content-type': compiled.contentType,
          'cache-control': 'no-cache',
          etag: `"${compiled.eTag}"`,
        },
      };
    }

    const staticAsset = tryReadProjectAsset(url);
    if (staticAsset) {
      const pathname = url.replace(/\?.*$/u, '');
      return {
        statusCode: 200,
        body: staticAsset.body,
        headers: {
          'content-type': staticAsset.contentType,
          'cache-control': HASHED_SHARED_JS_PATH.test(pathname)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        },
      };
    }
    if (kind === 'static' || kind === 'libs') {
      return {
        statusCode: 404,
        body: {
          ok: false,
          data: null,
          error: { code: 'NOT_FOUND', message: 'Route not found' },
        },
      };
    }

    const appFile = await tryReadAppFile(url);
    if (appFile) {
      return {
        statusCode: 200,
        body: appFile.body,
        headers: {
          'content-type': appFile.contentType,
          'cache-control': 'no-cache',
        },
      };
    }
  }

  if (method !== 'POST' || url !== '/execBff') {
    return {
      statusCode: 404,
      body: {
        ok: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Route not found' },
      },
    };
  }

  // The module a routine belongs to: `<module>.<page>.<command>`. Read here, before dispatch, because the
  // authorities are filtered by it.
  const routineModuleId = (payload: unknown): string => {
    const routine = (payload as { routine?: unknown } | null | undefined)?.routine;
    return typeof routine === 'string' ? routine.split('.')[0] ?? '' : '';
  };

  // AUTHENTICATION of the single door. Resolved here (not in execBff) because the token lives in a
  // TRANSPORT artifact — a cookie — and execBff is transport-agnostic: the message transport and the
  // sandbox runner reach it without any of this.
  const session = await resolveBffSession(headers);
  if (session.reject) {
    return {
      statusCode: 401,
      body: {
        ok: false,
        data: null,
        error: {
          code: 'UNAUTHENTICATED',
          message: session.reason === 'missing-token'
            ? 'No collab-auth session: sign in again.'
            : 'The collab-auth session is invalid or expired: sign in again.',
        },
      },
    };
  }
  // Stage 1 (enforcement off): say who WOULD have been refused, so the flip is a measured decision
  // instead of a guess. One line per unauthenticated call, with no token or claim value in it.
  if (!session.claims) {
    console.info(`[execBff] unauthenticated call (${session.reason}); BFF_JWT_ENABLED is off, serving anyway`);
  }

  try {
    const request = body as BffRequest;
    const result = await execBff({
      ...request,
      meta: {
        ...request.meta,
        source: 'http',
        // The VERIFIED identity, when there is one. execBff trusts this field only because the transport
        // just proved it against the JWKS — everything else the client claims about who it is is dropped.
        ...(session.claims ? {
          verifiedUserId: session.claims.sub,
          verifiedEmail: session.claims.email,
          // The module's authorities, filtered from the claims by the transport that verified them. They
          // become `sessionContext.actorScope`, which is what every generated controller gates on.
          verifiedAuthorities: moduleAuthorities(session.claims, routineModuleId(body)),
        } : {}),
      },
    }, ctx);
    return {
      statusCode: result.statusCode,
      body: result.response,
      ...(session.newAccessToken ? { headers: { 'set-cookie': refreshedAuthCookie(session.newAccessToken) } } : {}),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        data: null,
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON body',
          details: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

const isMainModule = process.argv[1]?.endsWith('startServer.js') || process.argv[1]?.endsWith('startServer.ts') ||
                     process.argv[1]?.endsWith('ProcessContainerFork.js') || // pm2 cluster fork
                     process.argv[1]?.endsWith('ProcessContainer.js'); // pm2 cluster master
console.log(`Starting server with isMainModule=${isMainModule}, argv[1]=${process.argv[1]}`);

/** Draft boot applies the draft schema before listen. Production (no COLLAB_DRAFT) only listens. */
export interface BootStepsInput {
  draft: boolean;
  runMigrations: () => Promise<void>;
  initializeOrganization?: () => Promise<void>;
  /** After migrations and organization bootstrap, before the process accepts traffic. */
  beforeListen?: () => Promise<void>;
  listen: () => Promise<void>;
}

export interface ServerWorkflowWakeLoop {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServerWorkflowWakeLifecycleDeps {
  readEnv?: () => { runtimeMode: 'memory' | 'postgres'; tickEnabled: boolean };
  createLoop?: () => ServerWorkflowWakeLoop;
}

/** Postgres inbox recovery. `tickEnabled` does not gate it. Memory runtime does not start a loop. */
export function createServerWorkflowWakeLifecycle(
  deps: ServerWorkflowWakeLifecycleDeps = {},
): ServerWorkflowWakeLoop {
  const readEnv = deps.readEnv ?? (() => {
    const env = readAppEnv();
    return { runtimeMode: env.runtimeMode, tickEnabled: env.tickEnabled };
  });
  const createLoop = deps.createLoop ?? (() => new WorkflowWakeInboxLoop());
  let loop: ServerWorkflowWakeLoop | null = null;
  return {
    async start() {
      if (loop) return;
      const env = readEnv();
      if (env.runtimeMode !== 'postgres') return;
      const created = createLoop();
      loop = created;
      // Do not hold listen on the first round: a round may call handlers that wait on the cm.
      // The loop never throws from start; stop() still waits for the round in flight.
      void created.start();
    },
    async stop() {
      if (!loop) return;
      await loop.stop();
    },
  };
}

export async function bootSteps(input: BootStepsInput): Promise<void> {
  if (input.draft) {
    try {
      await input.runMigrations();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[boot] draft migrations failed; refusing to listen: ${cause}`);
      process.exit(1);
      throw new Error(`[boot] process.exit(1) was ignored after: ${cause}`);
    }
  }
  if (input.initializeOrganization) {
    try {
      await input.initializeOrganization();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`[boot] organization bootstrap failed; refusing to listen: ${cause}`);
      process.exit(1);
      throw new Error(`[boot] process.exit(1) was ignored after: ${cause}`);
    }
  }
  if (input.beforeListen) await input.beforeListen();
  await input.listen();
}

if (isMainModule) {
  const env = readAppEnv();
  const server = buildHttpServer();
  const runtimeMetricsCollector = env.runtimeMode === 'postgres'
    ? createRuntimeMetricsCollector(env, readProjectsConfig().defaultProjectId)
    : null;
  const moduleTickLoop = env.runtimeMode === 'postgres' && env.tickEnabled ? new ModuleTickLoop() : null;
  const workflowWakeLifecycle = createServerWorkflowWakeLifecycle();
  server.addHook('onClose', async () => {
    runtimeMetricsCollector?.stop();
    moduleTickLoop?.stop();
    await workflowWakeLifecycle.stop();
  });
  void bootSteps({
    draft: Boolean(process.env.COLLAB_DRAFT),
    runMigrations: async () => {
      const { runMigrations } = await import('/_102034_/l1/scripts/migrate.js');
      await runMigrations();
    },
    initializeOrganization: () => initializeOrganizationForProcess(),
    beforeListen: () => workflowWakeLifecycle.start(),
    listen: () => getFrontendAppRegistrations().then((apps) => {
    // Logs the [alpha] line at boot when the VM switch is on (the check itself warns on every off→on flip).
    isAlphaAllAuthorities();
    // `return`: sem ele a promessa do listen fica ORFA e o `.catch` la embaixo nao a ve. Um
    // EADDRINUSE produziria exatamente o zumbi que esta correcao existe para matar (processo vivo,
    // pm2 verde, ninguem escutando) — so que uma camada mais fundo.
    return server.listen({ port: env.port, host: '0.0.0.0' }).then(() => {
    console.info(`MDM BFF listening on port ${env.port}`);
    console.info(`Registered frontend apps: ${apps.map((app) => `${app.appId}:${app.basePath}`).join(', ')}`);
    if (runtimeMetricsCollector) {
      void runtimeMetricsCollector.start()
        .then(() => console.info('Runtime metrics collection enabled every 5000ms'))
        .catch((error) => console.error('[runtimeMetrics] startup failed:', error));
    }
    if (moduleTickLoop) {
      void moduleTickLoop.start()
        .then((count) => console.info(`Module tick enabled every ${MODULE_TICK_INTERVAL_MS}ms for ${count} module(s)`))
        .catch((error) => console.error('[tick] startup failed:', error));
    }
    if (env.runtimeMode === 'postgres' && env.writeBehindEnabled) {
      const worker = new WriteBehindWorker(env);
      const runWorker = async () => {
        try {
          const result = await worker.runOnce();
          if (result.processed > 0 || result.failed > 0) {
            console.info(`Write-behind processed=${result.processed} failed=${result.failed}`);
          }
        } catch (error) {
          console.error('Write-behind loop failed', error);
        }
      };

      void runWorker();
      setInterval(() => {
        void runWorker();
      }, WRITE_BEHIND_INTERVAL_MS);
      console.info(`Write-behind loop enabled every ${WRITE_BEHIND_INTERVAL_MS}ms`);
    }
  });
  }).catch((error) => {
    failFrontendRegistryBoot(error);
  }),
  });
}

/** Registry failure used to be an unhandledRejection: pm2 stayed green, listen never ran.
 *  Exit nonzero so pm2 marks error and the release probe fails with the missing key. */
export function failFrontendRegistryBoot(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[boot] frontend registry failed; refusing to listen so pm2 marks error: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
  throw new Error(`[boot] process.exit(1) was ignored after: ${message}`);
}
