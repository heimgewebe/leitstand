import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = resolve('scripts/export-operator-snapshots.mjs');
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

it('exports a bounded five-section decision axis without creating local authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-decision-export-'));
  roots.push(root);
  const rawPath = join(root, 'decision.json');
  const outDir = join(root, 'out');
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: `B${index}`,
    title: `Blocked ${index}`,
    detail: 'source-bound blocker',
    meta: 'Bureau',
  }));
  const section = (source: string, items: unknown[], status = 'available') => ({
    status,
    source,
    observedAt: '2026-07-23T20:00:00Z',
    items,
  });
  await writeFile(rawPath, JSON.stringify({
    sections: {
      now: section('Bureau status-projection / registry queue', [{ id: 'T1', title: 'Now' }]),
      focus: section('Bureau Live Register', [{ id: 'F1', title: 'Focus' }]),
      blocked: section('Bureau status-projection blocker evidence', many),
      convergence: section('Grabowski current_work convergence projection', many),
      later: section('Bureau status-projection / registry queue', [], 'unknown'),
    },
  }), 'utf-8');

  await execFileAsync(process.execPath, [scriptPath, '--decision-raw', rawPath, '--out-dir', outDir]);
  const snapshot = JSON.parse(await readFile(join(outDir, 'operator-decision-axis.json'), 'utf-8')) as {
    kind: string;
    doesNotEstablish: string[];
    sections: Record<string, { status: string; items: unknown[] }>;
  };

  expect(snapshot.kind).toBe('leitstand_operator_decision_axis_snapshot');
  expect(Object.keys(snapshot.sections)).toEqual(['now', 'focus', 'blocked', 'convergence', 'later']);
  expect(snapshot.sections.blocked.items).toHaveLength(8);
  expect(snapshot.sections.convergence.items).toHaveLength(8);
  expect(snapshot.sections.later).toMatchObject({ status: 'unknown', items: [] });
  expect(snapshot.doesNotEstablish).toContain('task_or_priority_authority');
  expect(snapshot.doesNotEstablish).toContain('dispatch_or_mutation_authority');
});

describe('observer boundary', () => {
  it('keeps Bureau and Grabowski collection out of request-time controller code', async () => {
    const controller = await readFile(resolve('src/controllers/decisionAxis.ts'), 'utf-8');
    const dashboard = await readFile(resolve('src/controllers/dashboard.ts'), 'utf-8');
    expect(controller).not.toContain('child_process');
    expect(controller).not.toContain('grabowski_current_work');
    expect(dashboard).not.toContain('child_process');
    expect(controller).toContain('operator-decision-axis.json');
  });
});
