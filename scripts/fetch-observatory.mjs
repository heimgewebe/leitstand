import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from 'url';
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let URL = process.env.OBSERVATORY_URL;

if (process.env.OBSERVATORY_ARTIFACT_URL) {
    console.warn("[leitstand] DEPRECATED: OBSERVATORY_ARTIFACT_URL is set; use OBSERVATORY_URL instead.");
    if (!URL) URL = process.env.OBSERVATORY_ARTIFACT_URL;
}

if (!URL) {
    URL = "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";
}

let OUT = process.env.OBSERVATORY_ARTIFACT_PATH || process.env.OBSERVATORY_OUT_PATH || "artifacts/knowledge.observatory.json";

if (process.env.OBSERVATORY_OUT_PATH && !process.env.OBSERVATORY_ARTIFACT_PATH) {
    console.warn("[leitstand] WARN: OBSERVATORY_OUT_PATH is deprecated. Use OBSERVATORY_ARTIFACT_PATH.");
}

const strict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === "production" || process.env.OBSERVATORY_STRICT === "1";

await mkdir(path.dirname(OUT), { recursive: true });
console.log(`[leitstand] Fetch source: ${URL}`);
console.log(`[leitstand] Output path: ${OUT}`);
console.log(`[leitstand] strict=${strict}`);

try {
  const res = await fetch(URL);
  if (!res.ok) {
     throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const fileStream = fs.createWriteStream(OUT);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
  console.log(`[leitstand] Fetch complete.`);
} catch (err) {
  if (strict) {
      console.error(`[leitstand] FATAL: Fetch failed: ${err.message}`);
      process.exit(1);
  }
  console.warn(`[leitstand] WARN: Fetch failed: ${err.message}. Proceeding without artifact.`);
}

if (fs.existsSync(OUT)) {
  const s = fs.readFileSync(OUT, "utf8");
  if (s.trim().length < 10) {
    if (strict) {
        console.error("[leitstand] FATAL: Artifact file is empty/suspiciously small.");
        process.exit(1);
    }
    console.warn("[leitstand] Artifact looks empty/small; build may fallback.");
  }
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object") throw new Error("Artifact JSON is not an object.");

    // Load Schema from vendor path
    const SCHEMA_PATH = path.resolve(__dirname, "..", "vendor", "contracts", "knowledge.observatory.schema.json");

    if (fs.existsSync(SCHEMA_PATH)) {
        try {
            const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
            const ajv = new Ajv({ strict: strict, allErrors: true });
            addFormats(ajv);
            const validate = ajv.compile(schema);
            const valid = validate(obj);

            if (!valid) {
                 const errors = validate.errors.map(e => `${e.instancePath} ${e.message}`).join(', ');
                 throw new Error(`Schema violation: ${errors}`);
            }
            console.log(`[leitstand] Validated against schema: ${SCHEMA_PATH}`);
        } catch (schemaErr) {
             // If validation failed, check strictness
             if (schemaErr.message.startsWith("Schema violation")) {
                 if (strict) {
                     console.error(`[leitstand] FATAL: ${schemaErr.message}`);
                     process.exit(1);
                 } else {
                     console.warn(`[leitstand] WARN: ${schemaErr.message}`);
                 }
             } else {
                 console.warn(`[leitstand] WARN: Schema validation skipped (load/compile error): ${schemaErr.message}`);
             }
        }
    } else {
        console.warn(`[leitstand] WARN: Contract not found at ${SCHEMA_PATH}. Validation skipped.`);
        // Fallback check if schema is missing
        if (!obj.generated_at) throw new Error("Artifact missing generated_at.");
    }

    console.log(`[leitstand] Artifact valid. bytes=${Buffer.byteLength(s, "utf8")} generated_at=${obj.generated_at} topics=${obj.topics ? obj.topics.length : '?'}`);
  } catch (e) {
    if (strict) {
        console.error(`[leitstand] FATAL: Artifact is not valid JSON/Schema: ${e.message}`);
        process.exit(1);
    }
    console.warn(`[leitstand] Artifact is not valid JSON: ${e.message}; build may fallback.`);
  }
}

// Update _meta.json
try {
  const META_PATH = "artifacts/_meta.json";
  await mkdir(path.dirname(META_PATH), { recursive: true });

  let meta = {};
  if (fs.existsSync(META_PATH)) {
    try { meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")); } catch (e) {}
  }

  meta.fetched_at = new Date().toISOString();
  meta.strict = strict;

  const fileExists = fs.existsSync(OUT);
  let bytes = 0;
  let parsed = false;

  if (fileExists) {
    const s = fs.readFileSync(OUT, "utf8");
    bytes = Buffer.byteLength(s, "utf8");
    try { JSON.parse(s); parsed = true; } catch (e) {}
  }

  meta.observatory = {
    path: OUT,
    bytes: bytes,
    source_url: URL,
    parsed: parsed
  };

  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
} catch (e) {
  console.warn("[leitstand] Failed to update _meta.json", e);
  if (strict) process.exit(1);
}
