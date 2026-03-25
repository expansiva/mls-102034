/// <mls fileReference="_102034_/l1/server/layer_1_external/transport/http/startServer.ts" enhancement="_blank" />
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { getFrontendAppByBasePath, getFrontendAppRegistrations, getAppPublicRootDir } from '/_102034_/l1/server/layer_1_external/frontend/appRegistry.js';
import { getPublicationTarget, readProjectsConfig, resolveActivePublicationDistPath } from '/_102034_/l1/server/layer_1_external/config/projectConfig.js';
import { readAppEnv } from '/_102034_/l1/server/layer_1_external/config/env.js';
import { execBff } from '/_102034_/l1/server/layer_2_controllers/execBff.js';
import { WriteBehindWorker } from '/_102034_/l1/mdm/layer_1_external/queue/WriteBehindWorker.js';
import type { BffRequest, FrontendAppRegistration, RequestContext } from '/_102034_/l1/server/layer_2_controllers/contracts.js';

const WRITE_BEHIND_INTERVAL_MS = 5000;

function getContentType(filePath: string) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
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
    routes: app.routes,
    headerEntrypoint: app.headerRenderer?.entrypoint,
    headerTag: app.headerRenderer?.tag,
    asideEntrypoint: app.asideRenderer?.entrypoint,
    asideTag: app.asideRenderer?.tag,
    pageTitle: app.pageTitle,
    navigation: app.navigation ?? [],
    moduleLinks: app.moduleLinks ?? [],
    layout: app.layout,
  }).replace(/</gu, '\\u003c');

  return `<script>window.collabBoot=${payload};</script>`;
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
    const filePath = normalize(join(publicRootDir, relativePath));
    if (filePath.startsWith(publicRootDir) && existsSync(filePath)) {
      if (extname(filePath) === '.html') {
        return readAppHtml(filePath, app);
      }
      return readStaticFile(filePath);
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
  app.get('/', async (_request, reply) => {
    reply.redirect(await resolveDefaultFrontendLocation());
  });
  app.post('/execBff', async (request, reply) => {
    const result = await handleHttpRequest('POST', '/execBff', request.body);
    reply.status(result.statusCode);
    if (result.headers?.['content-type']) {
      reply.type(result.headers['content-type']);
    }
    return result.body;
  });
  app.get('/*', async (request, reply) => {
    const result = await handleHttpRequest('GET', request.url);
    reply.status(result.statusCode);
    if (result.headers?.['content-type']) {
      reply.type(result.headers['content-type']);
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

  if (method === 'GET') {
    const staticAsset = tryReadProjectAsset(url) ?? await tryReadAppFile(url);
    if (staticAsset) {
      return {
        statusCode: 200,
        body: staticAsset.body,
        headers: {
          'content-type': staticAsset.contentType,
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

  try {
    const request = body as BffRequest;
    const result = await execBff({
      ...request,
      meta: {
        ...request.meta,
        source: 'http',
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

const isMainModule = process.argv[1]?.endsWith('/startServer.js');

if (isMainModule) {
  const env = readAppEnv();
  const server = buildHttpServer();
  void getFrontendAppRegistrations().then((apps) => {
    server.listen({ port: env.port, host: '0.0.0.0' }).then(() => {
    console.info(`MDM BFF listening on port ${env.port}`);
    console.info(`Registered frontend apps: ${apps.map((app) => `${app.appId}:${app.basePath}`).join(', ')}`);
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
