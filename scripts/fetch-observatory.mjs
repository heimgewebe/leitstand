import fs from "fs";
import https from "https";
import { mkdir } from "fs/promises";

const URL =
  process.env.OBSERVATORY_ARTIFACT_URL ||
  process.env.OBSERVATORY_URL ||
  "https://raw.githubusercontent.com/heimgewebe/semantAH/main/artifacts/knowledge.observatory.json";

const OUT = "artifacts/knowledge.observatory.json";
const strict = process.env.NODE_ENV === "production" || process.env.OBSERVATORY_STRICT === "1";

await mkdir("artifacts", { recursive: true });
console.log("[leitstand] Fetching observatory from:", URL);

await new Promise((resolve, reject) => {
  https
    .get(URL, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`Failed to fetch artifact: HTTP ${res.statusCode}`);
        if (strict) return reject(err);
        console.warn(String(err));
        return resolve();
      }

      const file = fs.createWriteStream(OUT);
      res.pipe(file);

      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
      res.on("error", reject);
    })
    .on("error", (err) => {
      if (strict) return reject(err);
      console.warn(err);
      resolve();
    });
});

// Minimal sanity checks (guards against HTML error page etc.)
if (fs.existsSync(OUT)) {
  const s = fs.readFileSync(OUT, "utf8");
  if (s.trim().length < 10) {
    if (strict) throw new Error("Artifact file is empty/suspiciously small.");
    console.warn("[leitstand] Artifact looks empty/small; build may fallback.");
  }
  try {
    JSON.parse(s);
  } catch {
    if (strict) throw new Error("Artifact is not valid JSON.");
    console.warn("[leitstand] Artifact is not valid JSON; build may fallback.");
  }
}

console.log("[leitstand] Observatory fetch done.");
