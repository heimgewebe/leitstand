
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { loadRecentEvents } from '../dist/events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchDir = path.join(__dirname, 'bench_temp');

const FILE_COUNT = 20;
const LINES_PER_FILE = 10000;
const FIXED_TIMESTAMP = '2025-01-01T12:00:00.000Z';

async function setup() {
  if (fs.existsSync(benchDir)) {
    fs.rmSync(benchDir, { recursive: true, force: true });
  }
  fs.mkdirSync(benchDir);

  console.log(`Generating ${FILE_COUNT} files with ${LINES_PER_FILE} lines each...`);

  const buffer = [];
  // Use a fixed timestamp to avoid date creation overhead during setup
  // and ensure deterministic content.
  const eventStr = JSON.stringify({
    timestamp: FIXED_TIMESTAMP,
    kind: 'bench.event',
    repo: 'bench-repo',
    payload: { data: 'x'.repeat(100) }
  });

  for (let i = 0; i < LINES_PER_FILE; i++) {
    buffer.push(eventStr);
  }
  const content = buffer.join('\n');

  for (let i = 0; i < FILE_COUNT; i++) {
    fs.writeFileSync(path.join(benchDir, `events-${i}.jsonl`), content);
  }
}

async function run() {
  global.gc && global.gc(); // Try to force GC if run with --expose-gc

  const startMemory = process.memoryUsage().heapUsed;
  const start = performance.now();

  // Window covers the fixed timestamp
  const since = new Date('2025-01-01T00:00:00.000Z');
  const until = new Date('2025-01-02T00:00:00.000Z');

  console.log('Loading events...');
  const events = await loadRecentEvents(benchDir, since, until);

  const end = performance.now();
  const endMemory = process.memoryUsage().heapUsed;

  console.log(`Loaded ${events.length} events.`);
  console.log(`Time: ${(end - start).toFixed(2)} ms`);
  console.log(`Memory Diff: ${((endMemory - startMemory) / 1024 / 1024).toFixed(2)} MB`);
}

async function main() {
  try {
    await setup();
    await run();
  } finally {
    if (fs.existsSync(benchDir)) {
      fs.rmSync(benchDir, { recursive: true, force: true });
    }
  }
}

main().catch(console.error);
