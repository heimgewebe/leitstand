import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import ejs from "ejs";

const ROOT = process.cwd();
const VIEWS = join(ROOT, "src", "views");
const OUT = join(ROOT, "dist", "site");

async function readJson(path) {
  const txt = await readFile(path, "utf-8");
  if (!txt.trim()) throw new Error(`Empty JSON file: ${path}`);
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

  await mkdir(join(outPath, ".."), { recursive: true });
  await writeFile(outPath, html, "utf-8");
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // 1) Home
  await renderTo(join(OUT, "index.html"), "index");

  // 2) Observatory (Artefakt -> Fallback Fixture)
  const defaultArtifactPath = join(ROOT, "artifacts", "insights.daily.json");
  const artifactPath = process.env.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
  const fixturePath = join(ROOT, "src", "fixtures", "observatory.json");

  let observatoryData;
  let sourceKind;

  // Logic mirrors src/server.ts
  if (existsSync(artifactPath)) {
    try {
      observatoryData = await readJson(artifactPath);
      sourceKind = "artifact";
      console.log(`Loaded observatory data from artifact: ${artifactPath}`);
    } catch (e) {
      console.error(`Failed to load artifact: ${artifactPath}`);
      throw e;
    }
  } else {
    console.warn(`Artifact not found at ${artifactPath}, falling back to fixture.`);
    observatoryData = await readJson(fixturePath);
    sourceKind = "fixture";
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
