import express, { type Express } from 'express';
import { realpathSync } from 'node:fs';
import { type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { envConfig } from './config.js';
import { getBureauData } from './controllers/bureau.js';
import { getCheckoutData } from './controllers/checkouts.js';
import { getDashboardData } from './controllers/dashboard.js';
import { getEcosystemMapData } from './controllers/ecosystemMap.js';
import {
  buildEcosystemMapNavigation,
  serializeEcosystemMapNavigation,
} from './controllers/ecosystemMapNavigation.js';
import { getRepoBriefData } from './controllers/repoBrief.js';
import { getStorageHealthData } from './controllers/storageHealth.js';
import { getRuntimeHealthData } from './runtimeHealth.js';

const app: Express = express();
const defaultPort = envConfig.PORT;
const defaultBindHost = envConfig.bindHost;

app.set('view engine', 'ejs');
app.set('views', join(process.cwd(), 'src', 'views'));

// Release-local, read-only browser assets. Mermaid is served from the lockfile-bound
// dependency tree; the map view never depends on a third-party CDN.
app.use('/assets', express.static(join(process.cwd(), 'src', 'public'), {
  fallthrough: false,
  index: false,
  maxAge: '1h',
}));
app.use('/vendor/mermaid', express.static(join(process.cwd(), 'node_modules', 'mermaid', 'dist'), {
  fallthrough: false,
  index: false,
  maxAge: '1h',
}));

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// Runtime Health Receipt – read-only in-process proof surface for service and snapshot freshness.
app.get('/health', async (_req, res) => {
  try {
    const data = await getRuntimeHealthData();
    res.status(data.status === 'fail' ? 503 : 200).send(data);
  } catch (error) {
    console.error('[Health] Error:', error);
    res.status(500).send({
      schemaVersion: 1,
      kind: 'leitstand_runtime_health_receipt',
      status: 'fail',
      reason: 'runtime_health_unexpected_error',
    });
  }
});

app.get('/', async (_req, res) => {
  try {
    const data = await getDashboardData();
    res.render('index', data);
  } catch (error) {
    console.error('[Dashboard] Unexpected error:', error);
    res.render('index', { sources: [] });
  }
});

app.get('/repoground', async (_req, res) => {
  try {
    const data = await getRepoBriefData();
    res.render('repobriefs', data);
  } catch (error) {
    if (!res.headersSent) {
      console.error('[RepoGround] Error:', error);
      res.status(500).send('Error loading RepoGround data');
    }
  }
});

// Compatibility redirect only; /repoground is the canonical route.
app.get('/repobriefs', (_req, res) => {
  res.redirect(301, '/repoground');
});

// Bureau task board – read-only projection of Bureau task and claim truth.
app.get('/bureau', async (_req, res) => {
  try {
    const data = await getBureauData();
    res.render('bureau', data);
  } catch (error) {
    if (!res.headersSent) {
      console.error('[Bureau] Error:', error);
      res.status(500).send('Error loading bureau data');
    }
  }
});

// Checkout health – read-only projection of Grabowski checkout inventory.
app.get('/checkouts', async (_req, res) => {
  try {
    const data = await getCheckoutData();
    res.render('checkouts', data);
  } catch (error) {
    if (!res.headersSent) {
      console.error('[Checkouts] Error:', error);
      res.status(500).send('Error loading checkout data');
    }
  }
});

// Storage health – bounded read-only projection of Heim-PC evidence.
app.get('/storage-health', async (_req, res) => {
  try {
    const data = await getStorageHealthData();
    res.render('storage-health', data);
  } catch (error) {
    if (!res.headersSent) {
      console.error('[StorageHealth] Error:', error);
      res.status(500).send('Error loading storage health data');
    }
  }
});

app.get('/ecosystem-map', async (_req, res) => {
  try {
    const data = await getEcosystemMapData();
    const navigation = data.map?.content
      && data.view_meta.source_repository
      && data.view_meta.source_commit
      ? buildEcosystemMapNavigation(
        data.map.content,
        data.cross_links,
        data.view_meta.source_repository,
        data.view_meta.source_commit,
        data.map.path,
      )
      : [];
    res.render('ecosystem-map', {
      ...data,
      node_navigation_json: serializeEcosystemMapNavigation(navigation),
    });
  } catch (error) {
    if (!res.headersSent) {
      console.error('[EcosystemMap] Error:', error);
      res.status(500).send('Error loading ecosystem map data');
    }
  }
});

export interface StartServerOptions {
  port?: number;
  bindHost?: string;
  log?: boolean;
}

export function startServer(options: StartServerOptions = {}): Server {
  const port = options.port ?? defaultPort;
  const bindHost = options.bindHost ?? defaultBindHost;
  return app.listen(port, bindHost, () => {
    if (options.log === false) return;
    const displayHost = bindHost.includes(':') ? `[${bindHost}]` : bindHost;
    console.log(`Leitstand server running at http://${displayHost}:${port}`);
  });
}

let isDirectRun = false;
try {
  isDirectRun =
    !!process.argv[1] &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  // If path resolution fails, treat as not a direct run to avoid crashing on import.
  isDirectRun = false;
}

if (isDirectRun) {
  startServer();
}

export { app };
