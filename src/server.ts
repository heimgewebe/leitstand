import express, { Express } from 'express';
import { realpathSync } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { readJsonFile } from './utils/fs.js';
import { isLoopbackAddress } from './utils/network.js';
import { envConfig } from './config.js';
import { getObservatoryData } from './controllers/observatory.js';
import fs from 'fs';
import { validatePlexerReport } from './validation/validators.js';
import { randomBytes } from 'crypto';

const execPromise = promisify(exec);

// In-memory queue for _meta.json updates to prevent race conditions during read-modify-write cycles.
// Process-local only; not suitable for multi-process deployments (e.g. clusters or multiple containers).
let metaUpdateQueue = Promise.resolve();

/**
 * Enqueues a read-modify-write operation for _meta.json.
 */
async function enqueueMetaUpdate(updateFn: (meta: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  metaUpdateQueue = metaUpdateQueue.then(async () => {
    try {
      const artifactsDir = join(process.cwd(), 'artifacts');
      const metaPath = join(artifactsDir, '_meta.json');
      const tempPath = `${metaPath}.tmp`;

      // Ensure artifacts directory exists
      await fs.promises.mkdir(artifactsDir, { recursive: true });

      let meta: Record<string, unknown> = {};
      try {
        const content = await fs.promises.readFile(metaPath, 'utf8');
        meta = JSON.parse(content);
      } catch (e) {
        if (e instanceof Error && (e as { code?: string }).code !== 'ENOENT') {
          console.warn('[Meta] Warning: _meta.json could not be read or parsed, starting with empty object:', e.message);
        }
        // Proceed with empty meta on ENOENT or parse error
      }

      const updatedMeta = updateFn(meta);

      // Observer boundary: local artifact update for presentation/digest pipeline, not a system command path.
      await fs.promises.writeFile(tempPath, JSON.stringify(updatedMeta, null, 2));
      await fs.promises.rename(tempPath, metaPath);
    } catch (err) {
      console.warn('[Meta] Failed to update forensics:', err);
    }
  }).catch((err) => {
    // Ensure the queue continues even if a previous update failed catastrophically
    console.error('[Meta] Critical error in update queue:', err);
  });

  return metaUpdateQueue;
}

const app: Express = express();
const port = envConfig.PORT;

app.use(express.json());

// Set up EJS
app.set('view engine', 'ejs');
// We point to src/views for the MVP to avoid build complexity of copying assets
// This assumes the process is run from the root of the repo
app.set('views', join(process.cwd(), 'src', 'views'));

app.post('/events', async (req, res) => {
  // 1. Authorization
  const { token, isStrict } = envConfig;

  if (token) {
    // Token configured: Strict check (Bearer or X-Header)
    const authHeader = req.headers.authorization;
    const xToken = req.headers['x-events-token'];

    let providedToken;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7);
    } else if (typeof xToken === 'string') {
      providedToken = xToken;
    }

    if (providedToken !== token) {
      console.warn('[Event] Unauthorized access attempt');
      res.status(401).send('Unauthorized');
      return;
    }
  } else {
    // No token: Check environment
    if (isStrict) {
      console.warn('[Event] LEITSTAND_EVENTS_TOKEN not configured in strict mode. Endpoint disabled.');
      res.status(403).send('Events endpoint disabled');
      return;
    }
    // Dev/Preview: Permissive (no token required)
    // Security Hardening: Unauthenticated access is strictly limited to localhost.
    const remoteAddress = req.socket.remoteAddress;

    if (!isLoopbackAddress(remoteAddress)) {
      console.warn(`[Event] Blocked unauthenticated remote access attempt from ${remoteAddress}`);
      res.status(401).send('Unauthorized: Token required for remote access');
      return;
    }
  }

  const event = req.body;
  if (!event || typeof event !== 'object') {
    res.status(400).send('Invalid event format');
    return;
  }

  // "Filter: type == knowledge.observatory.published.v1"
  const eventType = event.type || event.kind;

  if (eventType === 'knowledge.observatory.published.v1') {
    const { url, generated_at, sha, schema_ref } = event.payload || {};

    if (!url) {
      console.warn('Received observatory published event without URL');
      res.status(400).send('Missing payload.url');
      return;
    }

    // 2. URL Validation
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
        console.warn(`[Event] Blocked unsafe URL: ${url}`);
        res.status(400).send('Invalid URL domain or protocol');
        return;
      }
    } catch (e) {
      res.status(400).send('Invalid URL format');
      return;
    }

    // 3. Idempotency Check
    if (generated_at) {
      try {
        const artifactPath = join(process.cwd(), 'artifacts', 'knowledge.observatory.json');
        const currentData = await readJsonFile<{ generated_at?: string }>(artifactPath);
        if (currentData.generated_at === generated_at) {
          console.log(`[Event] Skipping duplicate event for generated_at=${generated_at}`);
          res.status(200).send({ status: 'skipped', reason: 'idempotent' });
          return;
        }
      } catch (e) {
        // Artifact missing or invalid - proceed with fetch
      }
    }

    console.log(`[Event] Received knowledge.observatory.published.v1. Fetching from ${url}`);

    try {
      // Execute the fetch script with the provided URL
      const env = {
        ...process.env,
        OBSERVATORY_URL: url,
        ...(sha && { OBSERVATORY_SHA: sha }),
        ...(schema_ref && { OBSERVATORY_SCHEMA_REF: schema_ref })
      };

      // Observer boundary: expected read-only fetch path; no orchestration intended here.
      await execPromise('node scripts/fetch-observatory.mjs', { env });

      console.log('[Event] Observatory refresh complete.');
      res.status(200).send({ status: 'refreshed', url });
    } catch (error) {
      console.error('[Event] Failed to refresh observatory:', error);
      res.status(500).send({
        error: 'Refresh failed'
      });
    }
  } else if (eventType === 'integrity.summary.published.v1') {
    // payload.url is expected to point to reports/integrity/summary.json (the report), not to event_payload.json
    const { summary_url, url } = event.payload || {};
    const finalUrl = summary_url || url;

    if (!finalUrl) {
      console.warn('Received integrity published event without url or summary_url');
      res.status(400).send('Missing payload.url');
      return;
    }

    // Soft enforcement: Warn if URL does not point to a summary.json file
    if (!finalUrl.endsWith('summary.json')) {
      console.warn(`[Event] WARN: Integrity URL '${finalUrl}' does not end in 'summary.json'. This deviates from the canonical contract.`);
    }

    console.log(`[Event] Received integrity.summary.published.v1. Fetching from ${finalUrl}`);

    try {
      // Execute the fetch script with the provided URL
      // Observer boundary: expected read-only fetch path; no orchestration intended here.
      await execPromise('node scripts/fetch-integrity.mjs', {
        env: { ...process.env, INTEGRITY_URL: finalUrl }
      });

      console.log('[Event] Integrity refresh complete.');
      res.status(200).send({ status: 'refreshed', url: finalUrl });
    } catch (error) {
      console.error('[Event] Failed to refresh integrity:', error);
      // Integrity failure is diagnostic only, so we log but maybe don't want to alert purely as error?
      // But standard protocol for POST is 500 if failed.
      res.status(500).send({
        error: 'Refresh failed'
      });
    }
  } else if (eventType === 'plexer.delivery.report.v1') {
    const payload = event.payload || {};

    // Validate schema
    try {
       const validation = validatePlexerReport(payload);
       if (!validation.valid) {
           const { isStrict } = envConfig;
           if (!isStrict && validation.status === 503) {
               console.warn(`[Event] WARN: Validator missing in non-strict mode. Proceeding with save.`);
           } else {
               console.warn(`[Event] Invalid Plexer Report: ${validation.error}`);
               res.status(validation.status).send({
                   error: validation.status === 400
                       ? 'Schema violation'
                       : validation.status === 503
                           ? 'Service Unavailable'
                           : 'Validation unavailable',
                   ...(validation.status === 400 ? { details: validation.error } : {})
               });
               return;
           }
       }

       // Save artifact
       const artifactPath = join(process.cwd(), 'artifacts', 'plexer.delivery.report.json');
       // Ensure dir exists?
       // We assume artifacts dir exists or we should create it
       const artifactsDir = join(process.cwd(), 'artifacts');

       await fs.promises.mkdir(artifactsDir, { recursive: true });

       const serializedPayload = JSON.stringify(payload, null, 2);
       const tempArtifactPath = artifactPath + '.' + process.pid + '.' + randomBytes(8).toString('hex') + '.tmp';

       // Observer boundary: local artifact update for presentation/digest pipeline, not a system command path.
       await fs.promises.writeFile(tempArtifactPath, serializedPayload);
       await fs.promises.rename(tempArtifactPath, artifactPath);

       // Forensics update (queued to prevent race conditions).
       // Treated as best-effort forensics: failure to update meta does not block or fail the event response.
       void enqueueMetaUpdate((meta) => {
           meta.plexer_report = {
             fetched_at: new Date().toISOString(),
             source_kind: 'event',
             bytes: Buffer.byteLength(JSON.stringify(payload))
           };
           return meta;
       });

       console.log('[Event] Plexer Delivery Report saved.');
       res.status(200).send({ status: 'saved' });

    } catch (e) {
       console.error('[Event] Failed to process Plexer report:', e);
       res.status(500).send({ error: 'Internal Server Error' });
    }
  } else {
    res.status(200).send({ status: 'ignored' });
  }
});

// Ops Viewer Route - Viewer UI; may request orchestration from ACS depending on configuration (allowJobFallback).
app.get('/ops', (_req, res) => {
  res.render('ops', {
    acsUrl: envConfig.acsUrl,
    configuredRepos: envConfig.repos,
    allowJobFallback: envConfig.allowJobFallback,
    acsViewerToken: envConfig.acsViewerToken
  });
});

app.get('/', (_req, res) => {
  res.render('index');
});

app.get('/observatory', async (_req, res) => {
  try {
    const data = await getObservatoryData();
    res.render('observatory', data);
  } catch (error) {
    if (!res.headersSent) {
       console.error('Final error handler:', error);
       const msg = error instanceof Error ? error.message : String(error);
       if (msg.includes('Strict Fail') || msg.includes('Strict Mode') || msg.includes('Strict:')) {
          res.status(503).send('Service Unavailable');
       } else {
          res.status(500).send('Error loading observatory data');
       }
    }
  }
});

app.get('/intent', async (_req, res) => {
  try {
    const dataPath = join(process.cwd(), 'src', 'fixtures', 'intent.json');
    const data = await readJsonFile(dataPath);
    res.render('intent', { data });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading intent data');
  }
});

let isDirectRun = false;
try {
  isDirectRun =
    !!process.argv[1] &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  // If path resolution fails, treat as not a direct run to avoid crashing on import
  isDirectRun = false;
}

if (isDirectRun) {
  app.listen(port, () => {
    console.log(`Leitstand server running at http://localhost:${port}`);
  });
}

/**
 * Test helper to wait for all currently enqueued metadata updates to complete.
 * Not intended for production use.
 */
export async function __wait_for_meta_queue(): Promise<void> {
  await metaUpdateQueue;
}

export { app };
