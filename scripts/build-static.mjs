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
  const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH ||
                       process.env.OBSERVATORY_OUT_PATH ||
                       defaultArtifactPath;

  if (process.env.OBSERVATORY_OUT_PATH && !process.env.OBSERVATORY_ARTIFACT_PATH) {
    console.warn("[leitstand] WARN: OBSERVATORY_OUT_PATH is deprecated. Use OBSERVATORY_ARTIFACT_PATH.");
  }

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
    const strict = process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';

    if (strict) {
      console.error(`FATAL: Observatory artifact failed in Production/Strict: ${artifactError}`);
      process.exit(1);
    }

    if (artifactError.code === 'ENOENT') {
      console.warn(`Artifact not found at ${artifactPath}, falling back to fixture.`);
    } else {
      console.warn(`Artifact invalid at ${artifactPath}, falling back to fixture: ${artifactError}`);
    }

    const fixtureContent = await readFile(fixturePath, 'utf-8');
    observatoryData = JSON.parse(fixtureContent);
    sourceKind = "fixture";
  }

  const observatoryUrl = process.env.OBSERVATORY_URL || "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";

  await mkdir(join(OUT, "observatory"), { recursive: true });
  await renderTo(
    join(OUT, "observatory", "index.html"),
    "observatory",
    { data: observatoryData },
    {
      view_meta: { source_kind: sourceKind },
      observatoryUrl: observatoryUrl
    }
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
