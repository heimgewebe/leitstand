import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import ejs from "ejs";

const ROOT = process.cwd();
const VIEWS = join(ROOT, "src", "views");
const OUT = join(ROOT, "dist", "site");

class EmptyFileError extends Error {
  code = 'EMPTY_FILE';
  constructor(message) {
    super(message);
    this.name = 'EmptyFileError';
  }
}

async function readJson(path) {
  const txt = await readFile(path, "utf-8");
  if (!txt.trim()) throw new EmptyFileError(`Empty JSON file: ${path}`);
  return JSON.parse(txt);
}

async function renderTo(outPath, viewName, data = {}, extraLocals = {}) {
  // Merge data and extraLocals so they are all available in 'locals' object in the template
  // This matches Express res.render behavior where all properties are merged.
  const context = { ...data, ...extraLocals };

  const html = await ejs.renderFile(join(VIEWS, `${viewName}.ejs`), context, {
    async: true,
    rmWhitespace: false,
    localsName: "locals", // accessible as 'locals' in template
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf-8");
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // 1) Home
  await renderTo(join(OUT, "index.html"), "index");

  // 2) Observatory (Artefakt -> Fallback Fixture)
  const defaultArtifactPath = join(ROOT, "artifacts", "knowledge.observatory.json");
  const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
  const fixturePath = join(ROOT, "src", "fixtures", "observatory.json");

  let observatoryData;
  let sourceKind;

  try {
    const artifactContent = await readFile(artifactPath, 'utf-8');
    if (!artifactContent.trim()) {
      throw new EmptyFileError('Artifact file is empty');
    }
    observatoryData = JSON.parse(artifactContent);
    sourceKind = "artifact";
    console.log(`Loaded observatory data from artifact: ${artifactPath}`);
  } catch (artifactError) {
    if (artifactError.code === 'ENOENT') {
      if (process.env.NODE_ENV === 'production') {
        console.error(`FATAL: Observatory artifact missing at ${artifactPath} in Production environment.`);
        process.exit(1);
      }
      // Fallback to fixture only if artifact is missing
      console.warn(`Artifact not found at ${artifactPath}, falling back to fixture.`);
      const fixtureContent = await readFile(fixturePath, 'utf-8');
      observatoryData = JSON.parse(fixtureContent);
      sourceKind = "fixture";
    } else if (artifactError instanceof SyntaxError || artifactError.name === 'SyntaxError') {
       console.error('Observatory artifact contains invalid JSON:', artifactError.message);
       throw new Error('Artifact file contains invalid JSON');
    } else if (artifactError instanceof EmptyFileError || artifactError.code === 'EMPTY_FILE') {
       console.warn('Observatory artifact file is empty (fallback to fixture)');
       const fixtureContent = await readFile(fixturePath, 'utf-8');
       observatoryData = JSON.parse(fixtureContent);
       sourceKind = "fixture";
    } else {
       console.error('Error reading observatory artifact:', artifactError.message);
       throw artifactError;
    }
  }

  await mkdir(join(OUT, "observatory"), { recursive: true });
  await renderTo(
    join(OUT, "observatory", "index.html"),
    "observatory",
    { data: observatoryData },
    { view_meta: { source_kind: sourceKind } }
  );

  // 3) Intent (Fixture)
  const intentPath = join(ROOT, "src", "fixtures", "intent.json");
  const intentData = await readJson(intentPath);

  await mkdir(join(OUT, "intent"), { recursive: true });
  await renderTo(join(OUT, "intent", "index.html"), "intent", { data: intentData });

  console.log("Static site generated at:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
