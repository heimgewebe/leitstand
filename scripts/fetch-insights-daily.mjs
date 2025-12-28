import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

let URL = process.env.INSIGHTS_DAILY_URL;

if (!URL) {
    URL = "https://github.com/heimgewebe/semantAH/releases/download/insights-daily/insights.daily.json";
}

let OUT = process.env.INSIGHTS_DAILY_ARTIFACT_PATH || "artifacts/insights.daily.json";

const strict = process.env.NODE_ENV === "production" || process.env.INSIGHTS_STRICT === "1";

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
    // Basic schema check for Daily Insights
    if (!obj.ts) throw new Error("Artifact missing ts.");
    if (!Array.isArray(obj.topics)) throw new Error("Artifact topics must be an array.");
    if (!Array.isArray(obj.questions)) throw new Error("Artifact questions must be an array.");
    if (!Array.isArray(obj.deltas)) throw new Error("Artifact deltas must be an array.");

    console.log(`[leitstand] Artifact valid. bytes=${Buffer.byteLength(s, "utf8")} ts=${obj.ts} topics=${obj.topics.length}`);
  } catch (e) {
    if (strict) {
        console.error(`[leitstand] FATAL: Artifact is not valid JSON/Schema: ${e.message}`);
        process.exit(1);
    }
    console.warn(`[leitstand] Artifact is not valid JSON: ${e.message}; build may fallback.`);
  }
}
