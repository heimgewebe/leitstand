import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath, URL as NodeURL } from 'url';
import { createHash } from "crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let OBS_URL = process.env.OBSERVATORY_URL;

if (process.env.OBSERVATORY_ARTIFACT_URL) {
    console.warn("[leitstand] DEPRECATED: OBSERVATORY_ARTIFACT_URL is set; use OBSERVATORY_URL instead.");
    if (!OBS_URL) OBS_URL = process.env.OBSERVATORY_ARTIFACT_URL;
}

if (!OBS_URL) {
    OBS_URL = "https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json";
}

let OUT = process.env.OBSERVATORY_ARTIFACT_PATH || process.env.OBSERVATORY_OUT_PATH || "artifacts/knowledge.observatory.json";
const EXPECTED_SHA = process.env.OBSERVATORY_SHA;
const SCHEMA_REF = process.env.OBSERVATORY_SCHEMA_REF;

// Enforce SCHEMA_REF allowlist if provided
if (SCHEMA_REF) {
    const ALLOWED_HOSTS = ['schemas.heimgewebe.org'];
    try {
        const u = new NodeURL(SCHEMA_REF);
        if (!ALLOWED_HOSTS.includes(u.hostname)) {
             throw new Error(`SCHEMA_REF hostname '${u.hostname}' not in allowlist.`);
        }
    } catch (e) {
        console.error(`[leitstand] FATAL: Invalid SCHEMA_REF: ${e.message}`);
        process.exit(1);
    }
}

if (process.env.OBSERVATORY_OUT_PATH && !process.env.OBSERVATORY_ARTIFACT_PATH) {
    console.warn("[leitstand] WARN: OBSERVATORY_OUT_PATH is deprecated. Use OBSERVATORY_ARTIFACT_PATH.");
}

const strict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === "production" || process.env.OBSERVATORY_STRICT === "1";

await mkdir(path.dirname(OUT), { recursive: true });
console.log(`[leitstand] Fetch source: ${OBS_URL}`);
console.log(`[leitstand] Output path: ${OUT}`);
console.log(`[leitstand] strict=${strict}`);

try {
  const res = await fetch(OBS_URL);
  if (!res.ok) {
     throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const fileStream = fs.createWriteStream(OUT);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
  console.log(`[leitstand] Fetch complete.`);

  // SHA Verification
  if (EXPECTED_SHA) {
      // Normalize SHA: support "sha256:" prefix
      let normalizedSha = EXPECTED_SHA;
      if (normalizedSha.startsWith('sha256:')) {
          normalizedSha = normalizedSha.slice(7);
      }

      if (!/^[a-f0-9]{64}$/i.test(normalizedSha)) {
          const msg = `Invalid SHA format: ${EXPECTED_SHA} (expected 64-char hex or sha256: prefix)`;
          if (strict) throw new Error(msg);
          console.warn(`[leitstand] WARN: ${msg}. Skipping verification.`);
      } else {
          const fileBuffer = fs.readFileSync(OUT);
          const hash = createHash('sha256').update(fileBuffer).digest('hex');
          if (hash.toLowerCase() !== normalizedSha.toLowerCase()) {
              throw new Error(`SHA mismatch. Expected ${EXPECTED_SHA}, got ${hash}`);
          }
          console.log(`[leitstand] SHA verified: ${hash}`);
      }
  }

} catch (err) {
  if (strict) {
      console.error(`[leitstand] FATAL: Fetch/Verify failed: ${err.message}`);
      process.exit(1);
  }
  console.warn(`[leitstand] WARN: Fetch/Verify failed: ${err.message}. Proceeding without artifact.`);
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
    const SCHEMA_PATH = path.resolve(__dirname, "..", "vendor", "contracts", "knowledge", "observatory.schema.json");
    console.log(`[leitstand] Debug: Checking schema at ${SCHEMA_PATH}`);

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
                     console.log(`[leitstand] FATAL: ${schemaErr.message}`); // Log to stdout for test visibility
                     process.exit(1);
                 } else {
                     console.log(`[leitstand] WARN: ${schemaErr.message}`);
                 }
             } else {
                 console.log(`[leitstand] WARN: Schema validation skipped (load/compile error): ${schemaErr.message}`);
             }
        }
    } else {
        console.log(`[leitstand] WARN: Contract not found at ${SCHEMA_PATH}. Validation skipped.`);
        console.log(`[leitstand] Debug: CWD is ${process.cwd()}`);
        console.log(`[leitstand] Debug: __dirname is ${__dirname}`);
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

  // meta.fetched_at = new Date().toISOString(); // Do not overwrite global fetched_at
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
    fetched_at: new Date().toISOString(),
    path: OUT,
    bytes: bytes,
    source_url: OBS_URL,
    parsed: parsed,
    sha: EXPECTED_SHA || null,
    schema_ref: SCHEMA_REF || null
  };

  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
} catch (e) {
  console.warn("[leitstand] Failed to update _meta.json", e);
  if (strict) process.exit(1);
}
