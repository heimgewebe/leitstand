import { copyFile, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import ejs from "ejs";

const ROOT = process.cwd();
const VIEWS = join(ROOT, "src", "views");
const OUT = join(ROOT, "dist", "site");
const STATIC_ASSETS = ["shell.css", "shell.mjs"];

async function copyStaticAssets() {
  const assetsOut = join(OUT, "assets");
  await mkdir(assetsOut, { recursive: true });
  await Promise.all(STATIC_ASSETS.map((name) => (
    copyFile(join(ROOT, "src", "public", name), join(assetsOut, name))
  )));
}

const STATIC_MIRROR_SUPPORTED_ROUTES = [
  { route: "/", output: "index.html", view: "index", reason: "static landing page" },
];

const STATIC_MIRROR_DYNAMIC_ONLY_ROUTES = [
  { route: "/events", reason: "runtime ingestion endpoint" },
  { route: "/ops", reason: "runtime ACS viewer and optional job fallback" },
  { route: "/bureau", reason: "execution-axis snapshot view remains runtime-rendered in Mode A" },
  { route: "/checkouts", reason: "checkout inventory view remains runtime-rendered in Mode A" },
  { route: "/storage-health", reason: "bounded storage-health artifact projection remains runtime-rendered in Mode A" },
  { route: "/ecosystem-map", reason: "system catalog artifact projection is runtime-rendered until static artifact parity is implemented" },
  { route: "/repobriefs", reason: "RepoBrief bundle index view is runtime-rendered until static artifact parity is implemented" },
  { route: "/anatomy", reason: "controller-backed structure view is runtime-rendered until static artifact parity is implemented" },
  { route: "/insights", reason: "controller-backed insights view is runtime-rendered until static artifact parity is implemented" },
  { route: "/timeline", reason: "time-windowed Chronik view is runtime-rendered" },
  { route: "/reflexion", reason: "controller-backed reflexion view is runtime-rendered until static artifact parity is implemented" },
];

function buildTimestamp() {
  const rawEpoch = process.env.SOURCE_DATE_EPOCH;
  if (rawEpoch && /^\d+$/.test(rawEpoch)) {
    return new Date(Number(rawEpoch) * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function writeStaticBoundaryManifest() {
  await writeFile(
    join(OUT, "_static-boundary.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "leitstand_static_mirror_boundary",
        generatedAt: buildTimestamp(),
        deploymentMode: "Mode B — Public Static Mirror / Preview",
        supportedRoutes: STATIC_MIRROR_SUPPORTED_ROUTES,
        dynamicOnlyRoutes: STATIC_MIRROR_DYNAMIC_ONLY_ROUTES,
        doesNotEstablish: [
          "canonical_runtime_availability",
          "events_ingestion",
          "ops_runtime_fallback",
          "bureau_snapshot_truth",
          "grabowski_checkout_truth",
          "storage_health_snapshot_truth",
          "route_parity_with_mode_a",
        ],
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

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
    async: false,
    rmWhitespace: false,
    localsName: "locals", // accessible as 'locals' in template
  });

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf-8");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await copyStaticAssets();

  // 1) Home
  await renderTo(join(OUT, "index.html"), "index", {}, { currentPath: "/" });

  // Strict Symmetry Check
  const isStrict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1';
  const isStrictFail = process.env.OBSERVATORY_STRICT_FAIL === '1';

  if (isStrict || isStrictFail) {
      const rawPath = process.env.OBSERVATORY_ARTIFACT_PATH || join(ROOT, "artifacts", "knowledge.observatory.json");
      const dailyPath = join(ROOT, "artifacts", "insights.daily.json");

      const checkArtifact = async (label, p) => {
          try {
              const content = await readFile(p, 'utf-8');
              if (!content || !content.trim()) throw new Error("Empty file");
              JSON.parse(content);
          } catch (e) {
              console.error(`STRICT CHECK: ${label} artifact issue at ${p}. Error: ${e.message}`);
              if (e instanceof SyntaxError) return 'corrupt';
              return 'missing';
          }
          return 'ok';
      };

      const rawStatus = await checkArtifact("Raw Observatory", rawPath);
      const dailyStatus = await checkArtifact("Daily Insights", dailyPath);

      if (rawStatus === 'corrupt' || dailyStatus === 'corrupt') {
          console.error("FATAL: Artifact corruption detected in Strict Mode.");
          process.exit(1);
      }

      if (isStrictFail && (rawStatus === 'missing' || dailyStatus === 'missing')) {
          console.error("FATAL: Artifacts missing in STRICT_FAIL mode.");
          process.exit(1);
      }

      if (rawStatus === 'missing' || dailyStatus === 'missing') {
          console.warn("WARN: One or more artifacts missing. Proceeding with EMPTY STATE (Strict Empty Mode).");
      }
  }

  await writeStaticBoundaryManifest();

  console.log("Static site generated at:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
