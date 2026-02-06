import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_EVENTS_PATH = path.join(__dirname, '../dist/events.js');

// Ensure we can import the module
if (!fs.existsSync(DIST_EVENTS_PATH)) {
  console.error('Error: ../dist/events.js not found. Please run "pnpm build" first.');
  process.exit(1);
}

const { loadRecentEvents } = await import(DIST_EVENTS_PATH);

const TEMP_DIR = path.join(__dirname, '../temp_bench_data');
const FILE_COUNT = 5;
const EVENTS_PER_FILE = 20000;

async function generateData() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log(`Generating ${FILE_COUNT} files with ${EVENTS_PER_FILE} events each...`);

  for (let i = 0; i < FILE_COUNT; i++) {
    const filePath = path.join(TEMP_DIR, `events_${i}.jsonl`);
    const stream = fs.createWriteStream(filePath);

    for (let j = 0; j < EVENTS_PER_FILE; j++) {
      const event = {
        timestamp: new Date(Date.now() - Math.floor(Math.random() * 10000000)).toISOString(),
        kind: 'bench.event',
        repo: 'bench/repo',
        payload: {
            id: j,
            data: 'x'.repeat(100) // Some payload
        }
      };
      stream.write(JSON.stringify(event) + '\n');
    }
    stream.end();
  }

  // Wait for files to be written
  await new Promise(r => setTimeout(r, 1000));
}

// Naive implementation as described in the task
async function naiveLoadEvents(dataDir, since, until) {
  const files = await fs.promises.readdir(dataDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
  const allEvents = [];
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  for (const file of jsonlFiles) {
    const filePath = path.join(dataDir, file);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const data = JSON.parse(line);
            if (data.timestamp >= sinceIso && data.timestamp < untilIso) {
                allEvents.push(data);
            }
        } catch (e) {}
    }
  }
  return allEvents;
}

async function measure(name, fn) {
  if (global.gc) global.gc(); // Try to GC if exposed

  const startMem = process.memoryUsage().heapUsed;
  const start = performance.now();

  const result = await fn();

  const end = performance.now();
  const endMem = process.memoryUsage().heapUsed;

  console.log(`[${name}]`);
  console.log(`  Time: ${(end - start).toFixed(2)}ms`);
  console.log(`  Events: ${result.length}`);
  console.log(`  Heap diff: ${((endMem - startMem) / 1024 / 1024).toFixed(2)} MB`);

  return { time: end - start, mem: endMem - startMem };
}

async function main() {
  await generateData();

  const since = new Date(Date.now() - 100000000);
  const until = new Date();

  console.log('\n--- Benchmarking ---');

  // Measure Naive
  await measure('Naive Implementation', () => naiveLoadEvents(TEMP_DIR, since, until));

  // Measure Current (Optimized)
  await measure('Current Implementation', () => loadRecentEvents(TEMP_DIR, since, until));

  // Cleanup
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

main().catch(console.error);
