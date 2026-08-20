/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServer.ts" enhancement="_blank" />
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { getFrontendAppByBasePath, getFrontendAppRegistrations, getAppPublicRootDir, getAppAssetRootDirs } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';
import { getPublicationTarget, readProjectsConfig, resolveActivePublicationDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { createDefaultRequestContext, execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { AppError } from '/_102034_/l1/server/layer_2_controllers/contracts.js';
import {
  isActorEnforcementOn, isBffAuthEnforced, moduleAuthorities, resolveBffSession,
} from '/_102034_/l1/server/layer_1_external/auth/bffAuth.js';
import { readProjectMode } from '/_102034_/l1/server/layer_1_external/config/projectMode.js';
import {
  effectiveAuthorities, readAuthorityOverride, refuseOverride, writeAuthorityOverride,
} from '/_102034_/l1/server/layer_1_external/auth/authorityOverride.js';
import { registerCbeRoutes } from '/_102034_/l1/server/layer_1_external/cbe/cbeRoutes.js';
import { getLatestJson, initCbeLatestJson } from '/_102034_/l1/server/layer_1_external/cbe/cbeLatestJson.js';
import { registerMsgProxy } from '/_102034_/l1/server/layer_1_external/transport/http/msgProxy.js';
import { getCompiledStaticFile } from '/_102034_/l1/server/layer_1_external/cbe/cbeCompiledStatic.js';
import { WriteBehindWorker } from '/_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.js';
import {
  createRuntimeMetricsCollector,
  loadRuntimeMetricSamples,
  parseRuntimeMetricsQuery,
} from '/_102034_/l1/monitor/layer_3_usecases/runtimeMetricsUsecases.js';
import type { BffRequest, FrontendAppRegistration, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const WRITE_BEHIND_INTERVAL_MS = 5000;

function getContentType(filePath: string) {
  switch (extname(filePath)) {
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

function buildBootConfigScript(app: FrontendAppRegistration) {
  if (!app.routes.length) {
    return '';
  }

  const payload = JSON.stringify({
    projectId: app.projectId,
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
  }).replace(/</gu, '\\u003c');

  // window.latest mirrors the studio index.html (versions from the central
  // latest.json — see cbeLatestJson): the client loads versioned libs with it.
  const latestJson = getLatestJson();
  const latestScript = latestJson ? `window.latest=${latestJson.replace(/</gu, '\\u003c')};` : '';
  return `<script>window.collabBoot=${payload};${latestScript}</script>`;
}

function injectBootConfig(html: string, app: FrontendAppRegistration) {
  const bootScript = buildBootConfigScript(app);
  if (!bootScript) {
    return html;
  }

  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${bootScript}\n  </head>`);
  }

  if (html.includes('<body>')) {
    return html.replace('<body>', `<body>\n    ${bootScript}`);
  }

  return `${bootScript}\n${html}`;
}

function readAppHtml(filePath: string, app: FrontendAppRegistration) {
  return {
    body: Buffer.from(injectBootConfig(readFileSync(filePath, 'utf8'), app), 'utf8'),
    contentType: 'text/html; charset=utf-8',
  };
}

function tryReadProjectAsset(urlPath: string) {
  const publicationTarget = getPublicationTarget();
  if (!publicationTarget.serveStaticFromServer) {
    return null;
  }

  if (urlPath.startsWith('/_chunks/')) {
    const chunkPath = resolveActivePublicationDistPath(`.${urlPath}`);
    if (!existsSync(chunkPath)) {
      return null;
    }
    return readStaticFile(chunkPath);
  }

  const match = /^\/(_\d+_)\/(l2)\/(.+)$/u.exec(urlPath);
  if (!match) {
    return null;
  }

  const [, projectSegment, layer, remainder] = match;
  const assetPath = resolveActivePublicationDistPath(`./${projectSegment}/${layer}/${remainder}`);
  if (!existsSync(assetPath)) {
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
      return extname(filePath) === '.html' ? readAppHtml(filePath, app) : readStaticFile(filePath);
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

export function buildHttpServer() {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ ok: true }));
  // cbe-compatible endpoints (login + mls lib assets) for the runtime VM.
  // Registered before the catch-all GET /* so /libs/* wins the route match.
  initCbeLatestJson();
  registerCbeRoutes(app);
  // Same-origin proxy to the collab-messages backend (pm2 "msg" app).
  registerMsgProxy(app);
  app.get('/', async (_request, reply) => {
    reply.redirect(await resolveDefaultFrontendLocation());
  });
  // The single door of a generated app: every action of every screen posts here, so authenticating THIS
  // route authenticates the whole app. The headers travel into the handler because the identity rides in
  // the **httpOnly `cauth` cookie** the runtime login writes — JS never sees that token, so the page
  // cannot send a header and does not need to: a same-origin request carries the cookie by itself
  // (bffAuth.resolveBffSession). Enforcement is off by default (`BFF_JWT_ENABLED`), stage 1: verify and
  // report, never lock out an app that is already published.
  app.post('/execBff', async (request, reply) => {
    const result = await handleHttpRequest('POST', '/execBff', request.body, undefined, request.headers);
    reply.status(result.statusCode);
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
   */
  app.get('/session/info', async (request, reply) => {
    const session = await resolveBffSession(request.headers);
    reply.header('cache-control', 'no-store');
    const mode = readProjectMode(readAppEnv().projectId);
    const real = [
      ...(Array.isArray(session.claims?.authorities) ? session.claims.authorities : []),
      ...(Array.isArray(session.claims?.roles) ? session.claims.roles : []),
    ].filter((value): value is string => typeof value === 'string');
    const override = session.claims && !refuseOverride(mode)
      ? await readAuthorityOverride(createDefaultRequestContext(), session.claims.sub)
      : null;
    const effective = effectiveAuthorities(real, override);
    return {
      authenticated: !!session.claims,
      email: session.claims?.email ?? null,
      // Standard OIDC profile claims, forwarded as-is so the client chrome (the header avatar) can
      // show who is logged in. Null when the IdP does not send them — the caller falls back to initials.
      name: (session.claims as { name?: unknown } | undefined)?.name ?? null,
      picture: (session.claims as { picture?: unknown } | undefined)?.picture ?? null,
      userId: session.claims?.sub ?? null,
      authorities: moduleAuthorities(session.claims, ''),
      // What the session ACTS with, and — always — what the user really has. The audit and the card show
      // both, so a presentation-mode action can never be read as the real user's own.
      allAuthorities: effective.authorities,
      realAuthorities: effective.real,
      overridden: effective.overridden,
      canOverride: !refuseOverride(mode),
      appEnv: mode,
      expiresAt: typeof session.claims?.exp === 'number' ? new Date(session.claims.exp * 1000).toISOString() : null,
      enforcement: { authentication: isBffAuthEnforced(), actors: isActorEnforcementOn() },
      reason: session.reason,
    };
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
  app.get('/*', async (request, reply) => {
    const result = await handleHttpRequest('GET', request.url);
    if (result.statusCode === 404) {
      // Module not in the dist (only config.json projects compile there):
      // fall back to the project's obj/compiled.zip, the same source the cbe
      // login delivers to the browser. Covers /_<id>_/l2/* imports (studio
      // components and lib deep-imports) when the service worker is not
      // controlling the page yet.
      const compiled = getCompiledStaticFile(request.raw.url ?? '');
      if (compiled) {
        const clientETag = ((request.headers['if-none-match'] as string | undefined) ?? '').replace(/^W\//u, '').replaceAll('"', '');
        if (clientETag && clientETag === compiled.eTag) {
          reply.status(304);
          return null;
        }
        reply
          .status(200)
          .header('Content-Type', compiled.contentType)
          .header('Cache-Control', 'no-cache')
          .header('ETag', `"${compiled.eTag}"`);
        return compiled.content;
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
    const staticAsset = tryReadProjectAsset(url) ?? await tryReadAppFile(url);
    if (staticAsset) {
      return {
        statusCode: 200,
        body: staticAsset.body,
        headers: {
          'content-type': staticAsset.contentType,
          // Force revalidation: without this the browser heuristically caches
          // app files (incl. /_chunks/*) and, after a new release, stale files
          // reference chunk hashes that no longer exist — dynamic imports then
          // fail. The server is local to the VM, so revalidation is cheap.
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

const isMainModule = process.argv[1]?.endsWith('startServer.js') ||
                     process.argv[1]?.endsWith('ProcessContainerFork.js') || // pm2 cluster fork
                     process.argv[1]?.endsWith('ProcessContainer.js'); // pm2 cluster master
console.log(`Starting server with isMainModule=${isMainModule}, argv[1]=${process.argv[1]}`);                      
if (isMainModule) {
  const env = readAppEnv();
  const server = buildHttpServer();
  const runtimeMetricsCollector = env.runtimeMode === 'postgres'
    ? createRuntimeMetricsCollector(env, readProjectsConfig().defaultProjectId)
    : null;
  server.addHook('onClose', async () => {
    runtimeMetricsCollector?.stop();
  });
  void getFrontendAppRegistrations().then((apps) => {
    server.listen({ port: env.port, host: '0.0.0.0' }).then(() => {
    console.info(`MDM BFF listening on port ${env.port}`);
    console.info(`Registered frontend apps: ${apps.map((app) => `${app.appId}:${app.basePath}`).join(', ')}`);
    if (runtimeMetricsCollector) {
      void runtimeMetricsCollector.start()
        .then(() => console.info('Runtime metrics collection enabled every 5000ms'))
        .catch((error) => console.error('[runtimeMetrics] startup failed:', error));
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
  });
}
