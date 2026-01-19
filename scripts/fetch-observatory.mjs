import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

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

    // Load Schema
    const SCHEMA_PATH = path.join(process.cwd(), "contracts", "knowledge.observatory.schema.json");
    if (fs.existsSync(SCHEMA_PATH)) {
        try {
            const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
            // Basic Schema Validation (Proxy for full AJV)
            if (schema.required && Array.isArray(schema.required)) {
                for (const field of schema.required) {
                    if (!(field in obj)) throw new Error(`Schema violation: Missing required field '${field}'`);

                    // Strengthen check: Type check for string fields (avoid null/empty holes)
                    if (schema.properties && schema.properties[field]) {
                        const type = schema.properties[field].type;
                        if (type === 'string') {
                            if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
                                throw new Error(`Schema violation: Field '${field}' must be a non-empty string`);
                            }
                        }
                    }
                }
            }
            if (schema.properties) {
                 if (schema.properties.topics && obj.topics && !Array.isArray(obj.topics)) {
                     throw new Error("Schema violation: 'topics' must be an array");
                 }
            }
            console.log(`[leitstand] Validated against schema: ${SCHEMA_PATH}`);
        } catch (schemaErr) {
             // If validation failed, throw it. If loading failed, log warn?
             if (schemaErr.message.startsWith("Schema violation")) throw schemaErr;
             console.warn(`[leitstand] WARN: Schema validation skipped (load error): ${schemaErr.message}`);

             // Fallback to manual checks if schema load fails
             if (!obj.generated_at) throw new Error("Artifact missing generated_at.");
             if (!obj.source) throw new Error("Artifact missing source.");
             if (!Array.isArray(obj.topics)) throw new Error("Artifact topics must be an array.");
        }
    } else {
        console.warn(`[leitstand] WARN: Contract not found at ${SCHEMA_PATH}. Using fallback validation.`);
        if (!obj.generated_at) throw new Error("Artifact missing generated_at.");
        if (!obj.source) throw new Error("Artifact missing source.");
        if (!Array.isArray(obj.topics)) throw new Error("Artifact topics must be an array.");
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
