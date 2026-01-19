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
  let missingReason = "unknown";

  try {
    const artifactContent = await readFile(artifactPath, 'utf-8');
    if (!artifactContent.trim()) {
      throw new EmptyFileError('Artifact file is empty');
    }
    observatoryData = JSON.parse(artifactContent);
    sourceKind = "artifact";
    missingReason = "ok";
    console.log(`Loaded observatory data from artifact: ${artifactPath}`);
  } catch (artifactError) {
    if (isStrictFail) {
        console.error(`FATAL: Observatory artifact failed in STRICT_FAIL: ${artifactError}`);
        process.exit(1);
    }

    if (isStrict) {
      if (artifactError instanceof SyntaxError) {
          console.error(`FATAL: Observatory artifact corrupt in Strict Mode: ${artifactError}`);
          process.exit(1);
      }
      // Robust classification
      if (artifactError instanceof EmptyFileError || (artifactError instanceof Error && artifactError.message === 'Empty file')) {
          missingReason = "empty";
      } else if (artifactError.code === 'ENOENT') {
          missingReason = "enoent";
      } else {
          missingReason = "unknown";
      }

      console.warn(`WARN: Observatory artifact missing in Strict Mode. Proceeding with EMPTY STATE.`);
      observatoryData = null;
      sourceKind = "missing";
    } else {
        if (artifactError.code === 'ENOENT') {
          console.warn(`Artifact not found at ${artifactPath}, falling back to fixture.`);
        } else {
          console.warn(`Artifact invalid at ${artifactPath}, falling back to fixture: ${artifactError}`);
        }

        const fixtureContent = await readFile(fixturePath, 'utf-8');
        observatoryData = JSON.parse(fixtureContent);
        sourceKind = "fixture";
    }
  }

  const observatoryUrl = process.env.OBSERVATORY_URL || "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";

  // Load insights.daily.json for static build
  const insightsArtifactPath = join(ROOT, 'artifacts', 'insights.daily.json');
  const insightsFixturePath = join(ROOT, 'src', 'fixtures', 'insights.daily.json');

  let insightsDaily = null;
  let insightsDailySource = null;
  let insightsMissingReason = "unknown";
  // isStrict already defined above

  // 1. Try local artifact (deterministic build)
  try {
    const content = await readFile(insightsArtifactPath, 'utf-8');
    if (!content.trim()) throw new Error("Empty insights file");
    insightsDaily = JSON.parse(content);
    insightsDailySource = 'artifact';
    insightsMissingReason = "ok";
    console.log(`Loaded insights daily from artifact: ${insightsArtifactPath}`);
  } catch (e) {
    // 2. Fallback to fixture or fail
    if (isStrictFail) {
        console.error(`FATAL: Insights artifact failed in STRICT_FAIL: ${e}`);
        process.exit(1);
    }
    if (isStrict) {
        if (e instanceof SyntaxError) {
            console.error(`FATAL: Insights artifact corrupt in Strict Mode: ${e}`);
            process.exit(1);
        }
        if (e instanceof Error && e.message.includes("Empty")) {
             insightsMissingReason = "empty";
        } else if (e.code === 'ENOENT') {
             insightsMissingReason = "enoent";
        } else {
             insightsMissingReason = "unknown";
        }

        console.warn("Strict build: Insights artifact missing. Proceeding with EMPTY STATE.");
        insightsDaily = null;
        insightsDailySource = "missing";
    } else {
        try {
          const content = await readFile(insightsFixturePath, 'utf-8');
          insightsDaily = JSON.parse(content);
          insightsDailySource = 'fixture';
          insightsMissingReason = 'fallback';
          console.warn('Loaded insights daily from fixture (fallback)');
        } catch (e2) {
          console.warn('Could not load insights.daily fixture:', e2.message);
        }
    }
  }

  // Load integrity.summary.json (System Integrity)
  const integrityArtifactPath = join(ROOT, 'artifacts', 'integrity.summary.json');
  const integrityFixturePath = join(ROOT, 'src', 'fixtures', 'integrity.summary.json');

  let integritySummary = null;
  let integritySource = null;
  let integrityMissingReason = 'unknown';

  try {
    const content = await readFile(integrityArtifactPath, 'utf-8');
    if (content.trim()) {
      integritySummary = JSON.parse(content);
      integritySource = 'artifact';
      integrityMissingReason = 'ok';
      console.log(`Loaded integrity summary from artifact: ${integrityArtifactPath}`);
    }
  } catch (e) {
    if (isStrictFail) {
      console.warn('Integrity artifact missing in Strict Fail mode. Ignoring per instruction (No CI-Fail).');
    }

    if (isStrict) {
      const msg = e instanceof Error ? e.message : String(e);
      integrityMissingReason = msg.includes('Empty file') ? 'empty' : 'enoent';
      integritySummary = null;
      integritySource = 'missing';
      console.warn("Strict build: Integrity artifact missing. Proceeding with EMPTY STATE.");
    } else {
      try {
        const content = await readFile(integrityFixturePath, 'utf-8');
        integritySummary = JSON.parse(content);
        integritySource = 'fixture';
        integrityMissingReason = 'fallback';
        console.warn('Loaded integrity summary from fixture (fallback)');
      } catch (e2) {
        integritySummary = null;
        integritySource = 'missing';
        integrityMissingReason = 'enoent';
        console.warn('Could not load integrity.summary fixture:', e2.message);
      }
    }
  }

  // Load Plexer Delivery Report
  const plexerArtifactPath = join(ROOT, 'artifacts', 'plexer.delivery.report.json');
  let plexerDelivery = null;
  try {
      const content = await readFile(plexerArtifactPath, 'utf-8');
      if (content.trim()) {
          plexerDelivery = JSON.parse(content);
          console.log(`Loaded plexer delivery report from artifact: ${plexerArtifactPath}`);
      }
  } catch (e) {
      console.warn("Plexer artifact missing (static build fallback).");
  }

  // Load self_state.json (Heimgeist)
  const selfStateArtifactPath = join(ROOT, 'artifacts', 'self_state.json');
  const selfStateFixturePath = join(ROOT, 'src', 'fixtures', 'self_state.json');

  let selfState = null;
  let selfStateSource = null;
  let selfStateMissingReason = 'unknown';

  try {
    const content = await readFile(selfStateArtifactPath, 'utf-8');
    if (content.trim()) {
      selfState = JSON.parse(content);
      selfStateSource = 'artifact';
      selfStateMissingReason = 'ok';
      console.log(`Loaded self_state from artifact: ${selfStateArtifactPath}`);
    }
  } catch (e) {
    if (isStrict) {
      console.warn("Strict build: Self-State artifact missing. Proceeding with EMPTY STATE.");
      selfState = null;
      selfStateSource = 'missing';
      selfStateMissingReason = 'enoent';
    } else {
      try {
        const content = await readFile(selfStateFixturePath, 'utf-8');
        selfState = JSON.parse(content);
        selfStateSource = 'fixture';
        selfStateMissingReason = 'fallback';
        console.warn('Loaded self_state from fixture (fallback)');
      } catch (e2) {
        selfState = null;
        selfStateSource = 'missing';
        selfStateMissingReason = 'enoent';
        console.warn('Could not load self_state fixture:', e2.message);
      }
    }
  }

  // Ensure history is sorted descending
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

  // Load _meta.json forensic trail
  let metaForensics = {};
  try {
      const metaPath = join(ROOT, "artifacts", "_meta.json");
      const metaContent = await readFile(metaPath, 'utf-8');
      metaForensics = JSON.parse(metaContent);
  } catch (e) { /* ignore in static build if missing, but pass if exists */ }

  await mkdir(join(OUT, "observatory"), { recursive: true });
  await renderTo(
    join(OUT, "observatory", "index.html"),
    "observatory",
    { data: observatoryData, insightsDaily, integritySummary, selfState, plexerDelivery },
    {
      view_meta: {
          source_kind: sourceKind,
          missing_reason: missingReason,
          insights_source_kind: insightsDailySource,
          integrity_source_kind: integritySource,
          self_state_source_kind: selfStateSource,
          self_state_schema_valid: selfStateSchemaValid,
          insights_missing_reason: insightsMissingReason,
          integrity_missing_reason: integrityMissingReason,
          self_state_missing_reason: selfStateMissingReason,
          is_strict: isStrict,
          forensics: metaForensics
      },
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
