import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDecisionAxisData } from '../../src/controllers/decisionAxis.js';

const roots: string[] = [];
const previousPath = process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH;

afterEach(async () => {
  vi.useRealTimers();
  if (previousPath === undefined) delete process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH;
  else process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH = previousPath;
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

async function writeSnapshot(generatedAt: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-decision-axis-'));
  roots.push(root);
  const path = join(root, 'operator-decision-axis.json');
  const section = (source: string, items: unknown[] = []) => ({ status: items.length ? 'available' : 'unknown', source, observedAt: generatedAt, items });
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    kind: 'leitstand_operator_decision_axis_snapshot',
    generatedAt,
    doesNotEstablish: ['queue_truth', 'dispatch_or_mutation_authority'],
    sections: {
      now: section('Bureau status-projection', [{ id: 'T1', title: 'Now', detail: 'ranked', meta: 'now' }]),
      focus: section('Bureau Live Register', [{ id: 'F1', title: 'Focus', detail: 'active', meta: 'focus' }]),
      blocked: section('Bureau blocker evidence', [{ id: 'B1', title: 'Blocked', detail: 'reason', meta: 'blocked' }]),
      convergence: section('Grabowski current_work', [{ id: 'C1', title: 'Convergence', detail: 'action', meta: 'blocking' }]),
      later: section('Bureau status-projection', [{ id: 'T2', title: 'Later', detail: 'ranked', meta: 'later' }]),
      ...overrides,
    },
  }), 'utf-8');
  return path;
}

describe('decision axis controller', () => {
  it('renders all five read-only source-bound sections from a fresh snapshot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T20:10:00Z'));
    process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH = await writeSnapshot('2026-07-23T20:00:00Z');

    const data = await getDecisionAxisData();

    expect(data.sections.map((section) => section.id)).toEqual(['now', 'focus', 'blocked', 'convergence', 'later']);
    expect(data.sections.every((section) => section.freshness_state === 'fresh')).toBe(true);
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.does_not_establish).toContain('queue_truth');
  });

  it('marks stale sections stale without inventing replacement values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T21:00:00Z'));
    process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH = await writeSnapshot('2026-07-23T20:00:00Z', {
      now: { status: 'unknown', source: 'Bureau status-projection', observedAt: '2026-07-23T20:00:00Z', items: [] },
      later: { status: 'unknown', source: 'Bureau status-projection', observedAt: '2026-07-23T20:00:00Z', items: [] },
    });

    const data = await getDecisionAxisData();
    expect(data.sections.find((section) => section.id === 'now')).toMatchObject({ status: 'unknown', items: [], freshness_state: 'stale' });
    expect(data.sections.find((section) => section.id === 'later')).toMatchObject({ status: 'unknown', items: [] });
  });

  it('degrades every section explicitly when the snapshot is missing', async () => {
    process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH = '/definitely/missing/operator-decision-axis.json';
    const data = await getDecisionAxisData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.sections.every((section) => section.status === 'unavailable' && section.items.length === 0)).toBe(true);
  });
});
