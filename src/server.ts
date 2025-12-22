import express from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';

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
    const artifactPath = join(process.cwd(), 'artifacts', 'insights.daily.json');
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'observatory.json');

    let data;
    let sourceKind;

    try {
      const artifactContent = await readFile(artifactPath, 'utf-8');
      data = JSON.parse(artifactContent);
      sourceKind = 'artifact';
      console.log('Observatory loaded from artifact');
    } catch (artifactError) {
      // Fallback to fixture
      const fixtureContent = await readFile(fixturePath, 'utf-8');
      data = JSON.parse(fixtureContent);
      sourceKind = 'fixture';
      console.log('Observatory loaded from fixture (fallback)');
    }

    // Pass meta info to view
    const viewData = {
      ...data,
      meta: {
        source_kind: sourceKind
      }
    };

    res.render('observatory', { data: viewData });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error loading observatory data');
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
