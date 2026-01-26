
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { loadRecentEvents } from '../dist/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.join(__dirname, 'bench_temp');

const FILE_COUNT = 20;
const LINES_PER_FILE = 10000;

async function setup() {
  if (fs.existsSync(benchDir)) {
    fs.rmSync(benchDir, { recursive: true, force: true });
  }
  fs.mkdirSync(benchDir);

  console.log(`Generating ${FILE_COUNT} files with ${LINES_PER_FILE} lines each...`);

  const buffer = [];
  for (let i = 0; i < LINES_PER_FILE; i++) {
    const event = {
      timestamp: new Date().toISOString(),
      kind: 'bench.event',
      repo: `repo-${i % 100}`,
      payload: { data: 'x'.repeat(100) } // payload to add weight
    };
    buffer.push(JSON.stringify(event));
  }
  const content = buffer.join('\n');

  for (let i = 0; i < FILE_COUNT; i++) {
    fs.writeFileSync(path.join(benchDir, `events-${i}.jsonl`), content);
  }
}

async function run() {
  global.gc && global.gc(); // Try to force GC if run with --expose-gc (optional)

  const startMemory = process.memoryUsage().heapUsed;
  const start = performance.now();

  const since = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
  const until = new Date(Date.now() + 1000 * 60 * 60); // 1 hour future (include all)

  console.log('Loading events...');
  const events = await loadRecentEvents(benchDir, since, until);

  const end = performance.now();
  const endMemory = process.memoryUsage().heapUsed;

  console.log(`Loaded ${events.length} events.`);
  console.log(`Time: ${(end - start).toFixed(2)} ms`);
  console.log(`Memory Diff: ${((endMemory - startMemory) / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  await setup();
  await run();
  // fs.rmSync(benchDir, { recursive: true, force: true });
}

main().catch(console.error);
