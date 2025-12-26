import fs from 'fs';
import https from 'https';
import { mkdir } from 'fs/promises';

const URL = process.env.OBSERVATORY_ARTIFACT_URL || process.env.OBSERVATORY_URL || "https://raw.githubusercontent.com/heimgewebe/semantAH/main/artifacts/knowledge.observatory.json";

await mkdir('artifacts', { recursive: true });

console.log("[leitstand] Fetching observatory from:", URL);

https.get(URL, res => {
  if (res.statusCode !== 200) {
    res.resume(); // Consume response to free resources
    if (process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1') {
       console.error(`Failed to fetch artifact: ${res.statusCode}`);
       process.exit(1);
    }
    console.warn(`Failed to fetch artifact: ${res.statusCode}. Proceeding without artifact.`);
    return;
  }

  const file = fs.createWriteStream('artifacts/knowledge.observatory.json');
  res.pipe(file);
  file.on('finish', () => {
      file.close();
      console.log('Artifact downloaded.');
  });
}).on('error', (err) => {
   if (process.env.NODE_ENV === 'production' || process.env.OBSERVATORY_STRICT === '1') {
       console.error(err);
       process.exit(1);
   }
   console.warn(err);
});
