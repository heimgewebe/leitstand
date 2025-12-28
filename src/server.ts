import express from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';

class EmptyFileError extends Error {
  code = 'EMPTY_FILE';
  constructor(message: string) {
    super(message);
    this.name = 'EmptyFileError';
  }
}

const app = express();
const port = process.env.PORT || 3000;

// Set up EJS
app.set('view engine', 'ejs');
// We point to src/views for the MVP to avoid build complexity of copying assets
// This assumes the process is run from the root of the repo
app.set('views', join(process.cwd(), 'src', 'views'));

app.get('/', (_req, res) => {
  res.render('index');
});

app.get('/observatory', async (_req, res) => {
  try {
    const defaultArtifactPath = join(process.cwd(), 'artifacts', 'knowledge.observatory.json');
    const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'observatory.json');
    const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';

    let data;
    let sourceKind;

    try {
      const artifactContent = await readFile(artifactPath, 'utf-8');
      if (!artifactContent.trim()) {
        throw new EmptyFileError('Artifact file is empty');
      }
      data = JSON.parse(artifactContent);
      sourceKind = 'artifact';
      console.log('Observatory loaded from artifact');
    } catch (artifactError) {
      // If strict mode is enabled, re-throw immediately to fail the request
      if (isStrict) {
        console.error('[STRICT MODE] Artifact load failed:', artifactError);
        throw artifactError;
      }

      // Type guards
      const isEnoent = (err: unknown): boolean =>
        typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'ENOENT';
      const isSyntaxError = (err: unknown): err is SyntaxError =>
        err instanceof SyntaxError || (typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'SyntaxError');

      if (isEnoent(artifactError)) {
        // Fallback to fixture only if artifact is missing
        const fixtureContent = await readFile(fixturePath, 'utf-8');
        data = JSON.parse(fixtureContent);
        sourceKind = 'fixture';
        console.warn('Observatory loaded from fixture (fallback) - artifact not found');
      } else if (isSyntaxError(artifactError)) {
        // Invalid JSON in artifact (dual check handles bundling/transpilation edge cases)
        const msg = artifactError instanceof Error ? artifactError.message : String(artifactError);
        console.error('Observatory artifact contains invalid JSON:', msg);
        throw new Error('Artifact file contains invalid JSON');
      } else if (artifactError instanceof EmptyFileError) {
        // Empty artifact file - treat as missing to trigger fallback
        console.warn('Observatory artifact file is empty (fallback to fixture)');
        const fixtureContent = await readFile(fixturePath, 'utf-8');
        data = JSON.parse(fixtureContent);
        sourceKind = 'fixture';
      } else {
        // Other errors (e.g. permission denied)
        const msg = artifactError instanceof Error ? artifactError.message : String(artifactError);
        console.error('Error reading observatory artifact:', msg);
        throw artifactError;
      }
    }

    // Load insights.daily.json (Compressed/Published Knowledge)
    const insightsArtifactPath = join(process.cwd(), 'artifacts', 'insights.daily.json');
    const insightsFixturePath = join(process.cwd(), 'src', 'fixtures', 'insights.daily.json');

    let insightsDaily = null;
    let insightsDailySource = null;
    // Server logic also respects strict env (already defined above)

    // 1. Try local artifact
    try {
      const content = await readFile(insightsArtifactPath, 'utf-8');
      if (content.trim()) {
        insightsDaily = JSON.parse(content);
        insightsDailySource = 'artifact';
      }
    } catch (e) {
      // 2. Fallback to fixture (only in non-strict mode, no runtime fetch)
      if (isStrict) {
        console.error('[STRICT MODE] Insights artifact load failed:', e);
        throw new Error("Strict requires Raw + Daily. Insights missing.");
      } else if (!insightsDaily) {
         try {
           const content = await readFile(insightsFixturePath, 'utf-8');
           insightsDaily = JSON.parse(content);
           insightsDailySource = 'fixture';
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
      view_meta: {
        source_kind: sourceKind,
        insights_source_kind: insightsDailySource,
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
