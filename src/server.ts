import express from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

class EmptyFileError extends Error {
  code = 'EMPTY_FILE';
  constructor(message: string) {
    super(message);
    this.name = 'EmptyFileError';
  }
}

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Set up EJS
app.set('view engine', 'ejs');
// We point to src/views for the MVP to avoid build complexity of copying assets
// This assumes the process is run from the root of the repo
app.set('views', join(process.cwd(), 'src', 'views'));

app.post('/events', async (req, res) => {
  // 1. Authorization
  const token = process.env.LEITSTAND_EVENTS_TOKEN;
  if (!token) {
    console.warn('[Event] LEITSTAND_EVENTS_TOKEN not configured. Endpoint disabled.');
    res.status(403).send('Events endpoint disabled');
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${token}`) {
    console.warn('[Event] Unauthorized access attempt');
    res.status(401).send('Unauthorized');
    return;
  }

  const event = req.body;
  if (!event || typeof event !== 'object') {
    res.status(400).send('Invalid event format');
    return;
  }

  // "Filter: type == knowledge.observatory.published.v1"
  const eventType = event.type || event.kind;

  if (eventType === 'knowledge.observatory.published.v1') {
    const { url, generated_at } = event.payload || {};

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
        const content = await readFile(artifactPath, 'utf-8');
        const currentData = JSON.parse(content);
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
      await execPromise('node scripts/fetch-observatory.mjs', {
        env: { ...process.env, OBSERVATORY_URL: url }
      });

      console.log('[Event] Observatory refresh complete.');
      res.status(200).send({ status: 'refreshed', url });
    } catch (error) {
      console.error('[Event] Failed to refresh observatory:', error);
      res.status(500).send({
        error: 'Refresh failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    res.status(200).send({ status: 'ignored' });
  }
});

app.get('/', (_req, res) => {
  res.render('index');
});

app.get('/observatory', async (_req, res) => {
  try {
    const defaultArtifactPath = join(process.cwd(), 'artifacts', 'knowledge.observatory.json');
    const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'observatory.json');
    const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';
    const isStrictFail = process.env.OBSERVATORY_STRICT_FAIL === '1';
    const observatoryUrl = process.env.OBSERVATORY_URL || "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";

    let data;
    let sourceKind;
    let missingReason = 'unknown';

    try {
      const artifactContent = await readFile(artifactPath, 'utf-8');
      if (!artifactContent.trim()) {
        throw new EmptyFileError('Artifact file is empty');
      }
      data = JSON.parse(artifactContent);
      sourceKind = 'artifact';
      missingReason = 'ok';
      console.log('Observatory loaded from artifact');
    } catch (artifactError) {
      if (isStrictFail) {
         console.error('[STRICT FAIL] Artifact load failed. Aborting request.', artifactError);
         throw new Error("Strict Fail: Observatory artifact missing or invalid.");
      }

      // Type guards
      const isEnoent = (err: unknown): boolean =>
        typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'ENOENT';
      const isSyntaxError = (err: unknown): err is SyntaxError =>
        err instanceof SyntaxError || (typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'SyntaxError');

      // If strict mode is enabled (but not fail), we treat missing artifacts as Empty State.
      // BUT we still fail on corruption (SyntaxError).
      if (isStrict) {
        if (isSyntaxError(artifactError)) {
             console.error('[STRICT] Artifact corrupted (SyntaxError). Failing.', artifactError);
             missingReason = 'corrupt';
             throw new Error("Strict: Artifact file contains invalid JSON");
        }
        if (artifactError instanceof EmptyFileError) missingReason = 'empty';
        else if (isEnoent(artifactError)) missingReason = 'enoent';
        else missingReason = 'unknown';
        // For missing/empty files, we allow Empty State
        console.warn('[STRICT] Artifact missing/empty. Proceeding with Empty State.', artifactError instanceof Error ? artifactError.message : String(artifactError));
        data = null;
        sourceKind = 'missing';
      } else {
        // Dev / Fallback Mode
        if (isEnoent(artifactError)) {
          // Fallback to fixture only if artifact is missing
          const fixtureContent = await readFile(fixturePath, 'utf-8');
          data = JSON.parse(fixtureContent);
          sourceKind = 'fixture';
          missingReason = 'enoent';
          console.warn('Observatory loaded from fixture (fallback) - artifact not found');
        } else if (isSyntaxError(artifactError)) {
          // Invalid JSON in artifact
          const msg = artifactError instanceof Error ? artifactError.message : String(artifactError);
          missingReason = 'corrupt';
          console.error('Observatory artifact contains invalid JSON:', msg);
          throw new Error('Artifact file contains invalid JSON');
        } else if (artifactError instanceof EmptyFileError) {
          // Empty artifact file - treat as missing to trigger fallback
          console.warn('Observatory artifact file is empty (fallback to fixture)');
          const fixtureContent = await readFile(fixturePath, 'utf-8');
          data = JSON.parse(fixtureContent);
          sourceKind = 'fixture';
          missingReason = 'empty';
        } else {
          // Other errors (e.g. permission denied)
          const msg = artifactError instanceof Error ? artifactError.message : String(artifactError);
          missingReason = 'unknown';
          console.error('Error reading observatory artifact:', msg);
          throw artifactError;
        }
      }
    }

    // Load insights.daily.json (Compressed/Published Knowledge)
    const insightsArtifactPath = join(process.cwd(), 'artifacts', 'insights.daily.json');
    const insightsFixturePath = join(process.cwd(), 'src', 'fixtures', 'insights.daily.json');

    let insightsDaily = null;
    let insightsDailySource = null;
    let insightsMissingReason = 'unknown';

    // Server logic also respects strict env (already defined above)

    // 1. Try local artifact
    try {
      const content = await readFile(insightsArtifactPath, 'utf-8');
      if (content.trim()) {
        insightsDaily = JSON.parse(content);
        insightsDailySource = 'artifact';
        insightsMissingReason = 'ok';
      }
    } catch (e) {
      // 2. Fallback to fixture (only in non-strict mode, no runtime fetch)
      if (isStrictFail) {
         throw new Error("Strict Fail: Insights artifact missing or invalid.");
      }

      const isSyntaxError = (err: unknown): err is SyntaxError =>
        err instanceof SyntaxError || (typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'SyntaxError');

      if (isStrict) {
        if (isSyntaxError(e)) {
             throw new Error("Strict: Insights artifact contains invalid JSON");
        }
        const msg = e instanceof Error ? e.message : String(e);
        insightsMissingReason = msg.includes('Empty file') ? 'empty' : 'enoent';

        console.warn('[STRICT] Insights artifact missing/empty. Proceeding with Empty State.', e instanceof Error ? e.message : String(e));
        // Do not throw, just leave insightsDaily as null
        insightsDaily = null;
        insightsDailySource = 'missing';
      } else if (!insightsDaily) {
         try {
           const content = await readFile(insightsFixturePath, 'utf-8');
           insightsDaily = JSON.parse(content);
           insightsDailySource = 'fixture';
           insightsMissingReason = 'fallback';
           console.warn('Insights Daily loaded from fixture (fallback)');
         } catch (e2) {
           console.warn('Could not load insights.daily fixture:', e2 instanceof Error ? e2.message : String(e2));
         }
      }
    }

    // Load forensic metadata if available
    let forensics = {};
    try {
      const metaPath = join(process.cwd(), 'artifacts', '_meta.json');
      const metaContent = await readFile(metaPath, 'utf-8');
      forensics = JSON.parse(metaContent);
    } catch (e) { /* ignore */ }

    res.render('observatory', {
      data,
      insightsDaily,
      observatoryUrl,
      view_meta: {
        source_kind: sourceKind,
        insights_source_kind: insightsDailySource,
        missing_reason: missingReason,
        insights_missing_reason: insightsMissingReason,
        is_strict: isStrict,
        forensics: forensics
      }
    });
  } catch (error) {
    // 500 handler already logs the error via the re-throw above, or allows generic error logging here
    // But since we logged the specific cause above, this might be redundant for artifact errors.
    // However, keeping it for unexpected errors is good practice.
    if (!res.headersSent) {
       console.error('Final error handler:', error);
       const msg = error instanceof Error ? error.message : String(error);
       if (msg.includes('Strict requires Raw + Daily') || msg.includes('Strict Mode')) {
          res.status(503).send(msg);
       } else {
          res.status(500).send('Error loading observatory data');
       }
    }
  }
});

app.get('/intent', async (_req, res) => {
  try {
    const dataPath = join(process.cwd(), 'src', 'fixtures', 'intent.json');
    const dataContent = await readFile(dataPath, 'utf-8');
    const data = JSON.parse(dataContent);
    res.render('intent', { data });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading intent data');
  }
});

app.listen(port, () => {
  console.log(`Leitstand server running at http://localhost:${port}`);
});
