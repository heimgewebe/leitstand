import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

let URL = process.env.INTEGRITY_URL;

if (!URL) {
  // Default not set - this script is usually called via event with explicit URL
  console.warn("[leitstand] WARN: INTEGRITY_URL not set. Usage: INTEGRITY_URL=... node scripts/fetch-integrity.mjs");
  process.exit(0); // Exit gracefully, as this is diagnostic only
}

const OUT = process.env.INTEGRITY_ARTIFACT_PATH || "artifacts/integrity.summary.json";
const META_PATH = "artifacts/_meta.json";

// Strict mode in integrity context:
// Even if LEITSTAND_STRICT is set, we treat integrity fetch failures as non-fatal (Diagnostic Only).
// However, we might want to log strictly if the artifact *exists* but is corrupt.
const strict = process.env.LEITSTAND_STRICT === '1' || process.env.NODE_ENV === "production";

await mkdir(path.dirname(OUT), { recursive: true });
console.log(`[leitstand] Fetch integrity source: ${URL}`);
console.log(`[leitstand] Output path: ${OUT}`);

let success = false;
let bytes = 0;
let parsed = false;
let counts = null;

try {
  const res = await fetch(URL);
  if (!res.ok) {
     throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  // Write to temp file first for atomicity
  const tempPath = OUT + ".tmp";
  const fileStream = fs.createWriteStream(tempPath);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));

  // Validate
  const s = fs.readFileSync(tempPath, "utf8");
  bytes = Buffer.byteLength(s, "utf8");

  const obj = JSON.parse(s);
  parsed = true;

  // Minimal Schema Check (Diagnostic)
  if (!obj || typeof obj !== "object") throw new Error("Artifact JSON is not an object.");
  if (!obj.generated_at) console.warn("[leitstand] WARN: Artifact missing generated_at.");
  if (!obj.counts) throw new Error("Artifact missing counts.");

  counts = obj.counts;

  // Move to final location
  fs.renameSync(tempPath, OUT);
  success = true;
  console.log(`[leitstand] Integrity fetch complete. bytes=${bytes}`);

} catch (err) {
  console.error(`[leitstand] Integrity fetch failed: ${err.message}.`);
  // Do NOT exit 1. This is diagnostic.
}

// Update _meta.json
try {
  let meta = {};
  if (fs.existsSync(META_PATH)) {
    try { meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")); } catch (e) {}
  }

  meta.fetched_at = new Date().toISOString();

  meta.integrity = {
    path: OUT,
    bytes: bytes,
    source_url: URL,
    parsed: parsed,
    success: success,
    counts: counts
  };

  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
} catch (e) {
  console.warn("[leitstand] Failed to update _meta.json for integrity", e);
}
