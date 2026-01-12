import express, { Express } from 'express';
import { realpathSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { loadLatestMetrics } from './metrics.js';
import { readJsonFile, InvalidJsonError } from './utils/fs.js';
import { loadWithFallback } from './utils/loader.js';

const execPromise = promisify(exec);

interface SelfModel {
  confidence: number;
  fatigue: number;
  risk_tension: number;
  autonomy_level: "dormant" | "aware" | "reflective" | "critical";
  last_updated?: string; // Optional now, since history has timestamps
  basis_signals: string[];
}

interface SelfStateSnapshot {
  timestamp: string;
  state: SelfModel;
}

interface SelfStateArtifact {
  schema?: string;
  current: SelfModel;
  history: SelfStateSnapshot[];
}

const app: Express = express();
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
  const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production';

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
        const currentData = await readJsonFile<any>(artifactPath);
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
    const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';
    const isStrictFail = process.env.OBSERVATORY_STRICT_FAIL === '1';
    const observatoryUrl = process.env.OBSERVATORY_URL || "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";

    // Load Knowledge Observatory
    const defaultArtifactPath = join(process.cwd(), 'artifacts', 'knowledge.observatory.json');
    const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'observatory.json');

    const observatoryLoad = await loadWithFallback(artifactPath, fixturePath, { strict: isStrict, strictFail: isStrictFail, name: 'Observatory' });
    const data = observatoryLoad.data;
    const sourceKind = observatoryLoad.source;
    const missingReason = observatoryLoad.reason;


    // Load insights.daily.json (Compressed/Published Knowledge)
    const insightsArtifactPath = join(process.cwd(), 'artifacts', 'insights.daily.json');
    const insightsFixturePath = join(process.cwd(), 'src', 'fixtures', 'insights.daily.json');

    const insightsLoad = await loadWithFallback(insightsArtifactPath, insightsFixturePath, { strict: isStrict, strictFail: isStrictFail, name: 'Insights Daily' });
    const insightsDaily = insightsLoad.data;
    const insightsDailySource = insightsLoad.source;
    const insightsMissingReason = insightsLoad.reason;


    // Load integrity summaries (System Integrity)
    // Supports multiple per-repo summaries in artifacts/integrity/ OR legacy single file
    const integrityDir = join(process.cwd(), 'artifacts', 'integrity');
    const legacyIntegrityPath = join(process.cwd(), 'artifacts', 'integrity.summary.json');

    interface IntegritySummary {
      repo: string;
      status: string;
      generated_at: string;
      counts?: {
        claims?: number;
        artifacts?: number;
        loop_gaps?: number;
        unclear?: number;
      };
      _source?: string;
      [key: string]: unknown;
    }

    // We will collect all summaries here
    const integritySummaries: IntegritySummary[] = [];
    let integritySource = 'missing'; // Default
    let integrityMissingReason = 'unknown';

    const loadIntegrityFile = async (path: string, sourceLabel: string): Promise<IntegritySummary | null> => {
      try {
        const json = await readJsonFile<IntegritySummary>(path);
        if (json && typeof json === 'object') {
             // Tag it for the UI
             json._source = sourceLabel;
             return json;
        }
        return null;
      } catch (e) {
        return null;
      }
    };

    // 1. Try loading from artifacts/integrity/*.json
    try {
      const files = await readdir(integrityDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      for (const file of jsonFiles) {
        const summary = await loadIntegrityFile(join(integrityDir, file), 'artifact');
        if (summary) integritySummaries.push(summary);
      }
    } catch (e) {
       // Directory might not exist, which is fine
    }

    // 2. Try loading legacy artifact
    const legacySummary = await loadIntegrityFile(legacyIntegrityPath, 'artifact');
    if (legacySummary) {
       // Avoid duplication if repo is same
       const exists = integritySummaries.find(s => s.repo === legacySummary.repo);
       if (!exists) integritySummaries.push(legacySummary);
    }

    // Determine source kind so far
    if (integritySummaries.length > 0) {
      integritySource = 'artifact';
      integrityMissingReason = 'ok';
    } else {
      // 3. Fallback to fixtures if not strict
      if (!isStrict) {
        const fixtureDir = join(process.cwd(), 'src', 'fixtures', 'integrity');
        const legacyFixturePath = join(process.cwd(), 'src', 'fixtures', 'integrity.summary.json');

        // Try directory fixtures
        try {
          const files = await readdir(fixtureDir);
          const jsonFiles = files.filter(f => f.endsWith('.json'));
          for (const file of jsonFiles) {
             const summary = await loadIntegrityFile(join(fixtureDir, file), 'fixture');
             if (summary) integritySummaries.push(summary);
          }
        } catch (e) { /* ignore */ }

        // Try legacy fixture
        const legacyFixture = await loadIntegrityFile(legacyFixturePath, 'fixture');
        if (legacyFixture) {
           const exists = integritySummaries.find(s => s.repo === legacyFixture.repo);
           if (!exists) integritySummaries.push(legacyFixture);
        }

        if (integritySummaries.length > 0) {
           integritySource = 'fixture';
           integrityMissingReason = 'fallback';
        } else {
           integritySource = 'missing';
           integrityMissingReason = 'enoent';
        }
      } else {
         // Strict mode and no artifacts found
         integritySource = 'missing';
         integrityMissingReason = 'enoent'; // or empty
      }
    }

    // Load Fleet Metrics (to identify missing repos)
    // We try to load the latest snapshot from artifacts/metrics/ or fixtures/metrics/
    let fleetMetrics = null;
    try {
        // Try artifacts first
        const metricsDir = join(process.cwd(), 'artifacts', 'metrics');
        fleetMetrics = await loadLatestMetrics(metricsDir);

        // Fallback to fixtures if not strict and not found
        if (!fleetMetrics && !isStrict) {
            const metricsFixtureDir = join(process.cwd(), 'src', 'fixtures', 'metrics');
            fleetMetrics = await loadLatestMetrics(metricsFixtureDir);
        }
    } catch (e) {
        console.warn('Failed to load fleet metrics for observatory:', e instanceof Error ? e.message : String(e));
    }

    // Load Self-State (Heimgeist Meta-Cognition)
    // Artifact: artifacts/self_state.json
    const selfStateArtifactPath = join(process.cwd(), 'artifacts', 'self_state.json');
    const selfStateFixturePath = join(process.cwd(), 'src', 'fixtures', 'self_state.json');

    // Policy Decision: strictFail is always false for Self-State because it is a diagnostic tool,
    // and its absence should not block the main Observatory dashboard.
    const selfStateLoad = await loadWithFallback<SelfStateArtifact>(selfStateArtifactPath, selfStateFixturePath, {
        strict: isStrict,
        strictFail: false,
        name: 'Self-State'
    });

    let selfState = selfStateLoad.data;
    const selfStateSource = selfStateLoad.source;
    const selfStateMissingReason = selfStateLoad.reason;

    // Ensure history is sorted descending by date (newest first)
    if (selfState && selfState.history && Array.isArray(selfState.history)) {
       selfState.history.sort((a, b) => {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
       });
    }

    // Check Schema
    let selfStateSchemaValid = false;
    const EXPECTED_SCHEMA = "heimgeist.self_state.bundle.v1";
    if (selfState) {
       if (selfState.schema === EXPECTED_SCHEMA) {
           selfStateSchemaValid = true;
       } else {
           console.warn(`[SelfState] Schema mismatch. Expected ${EXPECTED_SCHEMA}, got ${selfState.schema}`);
       }
    }

    // Load forensic metadata if available
    let forensics = {};
    try {
      const metaPath = join(process.cwd(), 'artifacts', '_meta.json');
      forensics = await readJsonFile(metaPath);
    } catch (e) { /* ignore */ }

    res.render('observatory', {
      data,
      insightsDaily,
      integritySummaries, // Passed as array now
      fleetMetrics,       // Passed to help identify MISSING repos
      selfState,          // Heimgeist Self-State
      observatoryUrl,
      view_meta: {
        source_kind: sourceKind,
        insights_source_kind: insightsDailySource,
        integrity_source_kind: integritySource,
        self_state_source_kind: selfStateSource,
        self_state_schema_valid: selfStateSchemaValid,
        missing_reason: missingReason,
        insights_missing_reason: insightsMissingReason,
        integrity_missing_reason: integrityMissingReason,
        self_state_missing_reason: selfStateMissingReason,
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
       if (msg.includes('Strict Fail') || msg.includes('Strict Mode') || msg.includes('Strict:')) {
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

export { app };
