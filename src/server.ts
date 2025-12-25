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
    const defaultArtifactPath = join(process.cwd(), 'artifacts', 'insights.daily.json');
    const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'observatory.json');

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
    } catch (artifactError: any) {
      if (artifactError.code === 'ENOENT') {
        // Fallback to fixture only if artifact is missing
        const fixtureContent = await readFile(fixturePath, 'utf-8');
        data = JSON.parse(fixtureContent);
        sourceKind = 'fixture';
        console.warn('Observatory loaded from fixture (fallback) - artifact not found');
      } else if (artifactError instanceof SyntaxError || artifactError?.name === 'SyntaxError') {
        // Invalid JSON in artifact (dual check handles bundling/transpilation edge cases)
        console.error('Observatory artifact contains invalid JSON:', artifactError.message);
        throw new Error('Artifact file contains invalid JSON');
      } else if (artifactError instanceof EmptyFileError) {
        // Empty artifact file - treat as missing to trigger fallback
        console.warn('Observatory artifact file is empty (fallback to fixture)');
        const fixtureContent = await readFile(fixturePath, 'utf-8');
        data = JSON.parse(fixtureContent);
        sourceKind = 'fixture';
      } else {
        // Other errors (e.g. permission denied)
        console.error('Error reading observatory artifact:', artifactError.message);
        throw artifactError;
      }
    }

    res.render('observatory', {
      data,
      view_meta: {
        source_kind: sourceKind
      }
    });
  } catch (error) {
    // 500 handler already logs the error via the re-throw above, or allows generic error logging here
    // But since we logged the specific cause above, this might be redundant for artifact errors.
    // However, keeping it for unexpected errors is good practice.
    if (!res.headersSent) {
       console.error('Final error handler:', error);
       res.status(500).send('Error loading observatory data');
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
