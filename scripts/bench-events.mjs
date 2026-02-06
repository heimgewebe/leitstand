import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { finished } from 'node:stream/promises';
import { once } from 'node:events';

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
const BASE_NOW = Date.now(); // Fixed reference time

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
      // Deterministic timestamp: spread events over time, 1 second apart
      const offsetMs = (i * EVENTS_PER_FILE + j) * 1000;
      const event = {
        timestamp: new Date(BASE_NOW - offsetMs).toISOString(),
        kind: 'bench.event',
        repo: 'bench/repo',
        payload: {
            id: j,
            data: 'x'.repeat(100) // Some payload
        }
      };

      const canWrite = stream.write(JSON.stringify(event) + '\n');
      if (!canWrite) {
        await once(stream, 'drain');
      }
    }
    stream.end();
    // Wait for file to be fully written and closed
    await finished(stream);
  }
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

  // Window covers all generated events (approx 28 hours history)
  // Max offset is roughly (5 * 20000) * 1000 ms = 100,000,000 ms = ~27.7 hours
  const since = new Date(BASE_NOW - 200000000); // Plenty of buffer
  const until = new Date(BASE_NOW + 10000);

  console.log('\n--- Benchmarking ---');

  // Measure Naive
  await measure('Naive Implementation', () => naiveLoadEvents(TEMP_DIR, since, until));

  // Measure Current (Optimized)
  await measure('Current Implementation', () => loadRecentEvents(TEMP_DIR, since, until));

  // Cleanup
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

main().catch(console.error);
