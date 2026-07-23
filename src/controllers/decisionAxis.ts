import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export type DecisionSourceKind = 'artifact' | 'missing' | 'corrupt';
export type DecisionFreshness = 'fresh' | 'stale' | 'unknown';
export type DecisionSectionStatus = 'available' | 'unknown' | 'unavailable';

export interface DecisionAxisItem {
  id: string;
  title: string;
  detail: string;
  meta: string;
}

export interface DecisionAxisSection {
  id: 'now' | 'focus' | 'blocked' | 'convergence' | 'later';
  label: 'Jetzt' | 'Im Fokus' | 'Blockiert' | 'Konvergenz' | 'Danach';
  status: DecisionSectionStatus;
  source: string;
  observed_at: string | null;
  freshness_state: DecisionFreshness;
  items: DecisionAxisItem[];
}

export interface DecisionAxisViewData {
  sections: DecisionAxisSection[];
  view_meta: {
    source_kind: DecisionSourceKind;
    source_path: string;
    source_path_display: string;
    missing_reason: string;
    generated_at: string | null;
    freshness_state: DecisionFreshness;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_operator_decision_axis_snapshot';
const STALE_AFTER_MS = 20 * 60 * 1000;
const SECTION_ORDER: Array<{ id: DecisionAxisSection['id']; label: DecisionAxisSection['label'] }> = [
  { id: 'now', label: 'Jetzt' },
  { id: 'focus', label: 'Im Fokus' },
  { id: 'blocked', label: 'Blockiert' },
  { id: 'convergence', label: 'Konvergenz' },
  { id: 'later', label: 'Danach' },
];
const DEFAULT_NON_CLAIMS = [
  'task_or_priority_authority',
  'queue_truth',
  'focus_authority',
  'runtime_or_convergence_authority',
  'dispatch_or_mutation_authority',
];

function snapshotPath(): string {
  return process.env.LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH
    || join(process.cwd(), 'artifacts', 'operator-decision-axis.json');
}

function freshnessOf(value: string | null): DecisionFreshness {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'unknown';
  return Date.now() - timestamp <= STALE_AFTER_MS ? 'fresh' : 'stale';
}

function displaySourcePath(sourcePath: string): string {
  const rel = relative(resolve(process.cwd()), resolve(sourcePath));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external snapshot>';
}

function parseItem(raw: unknown): DecisionAxisItem {
  if (!raw || typeof raw !== 'object') throw new Error('invalid decision-axis item');
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const title = typeof item.title === 'string' ? item.title : '';
  if (!id || !title) throw new Error('invalid decision-axis item identity');
  return {
    id,
    title,
    detail: typeof item.detail === 'string' ? item.detail : '',
    meta: typeof item.meta === 'string' ? item.meta : '',
  };
}

function parseSnapshot(raw: unknown): Omit<DecisionAxisViewData, 'view_meta'> & {
  generatedAt: string | null;
  doesNotEstablish: string[];
} {
  if (!raw || typeof raw !== 'object') throw new Error('invalid decision-axis snapshot');
  const snapshot = raw as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== CONTRACT_KIND) {
    throw new Error('invalid decision-axis snapshot contract');
  }
  const rawSections = snapshot.sections;
  if (!rawSections || typeof rawSections !== 'object' || Array.isArray(rawSections)) {
    throw new Error('invalid decision-axis sections');
  }
  const sectionsObject = rawSections as Record<string, unknown>;
  const sections = SECTION_ORDER.map(({ id, label }) => {
    const rawSection = sectionsObject[id];
    if (!rawSection || typeof rawSection !== 'object') throw new Error(`missing decision-axis section ${id}`);
    const section = rawSection as Record<string, unknown>;
    const status = section.status;
    if (status !== 'available' && status !== 'unknown' && status !== 'unavailable') {
      throw new Error(`invalid decision-axis section status ${id}`);
    }
    const observedAt = typeof section.observedAt === 'string' ? section.observedAt : null;
    const items = Array.isArray(section.items) ? section.items.slice(0, 8).map(parseItem) : [];
    return {
      id,
      label,
      status,
      source: typeof section.source === 'string' && section.source ? section.source : 'unknown',
      observed_at: observedAt,
      freshness_state: freshnessOf(observedAt),
      items,
    } satisfies DecisionAxisSection;
  });
  const nonClaims = Array.isArray(snapshot.doesNotEstablish)
    ? snapshot.doesNotEstablish.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    sections,
    generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null,
    doesNotEstablish: nonClaims.length > 0 ? nonClaims : DEFAULT_NON_CLAIMS,
  };
}

function emptyData(kind: DecisionSourceKind, reason: string, sourcePath: string): DecisionAxisViewData {
  return {
    sections: SECTION_ORDER.map(({ id, label }) => ({
      id,
      label,
      status: 'unavailable',
      source: 'unknown',
      observed_at: null,
      freshness_state: 'unknown',
      items: [],
    })),
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: reason,
      generated_at: null,
      freshness_state: 'unknown',
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

export async function getDecisionAxisData(): Promise<DecisionAxisViewData> {
  const sourcePath = resolve(snapshotPath());
  try {
    const parsed = parseSnapshot(JSON.parse(await readFile(sourcePath, 'utf-8')) as unknown);
    return {
      sections: parsed.sections,
      view_meta: {
        source_kind: 'artifact',
        source_path: sourcePath,
        source_path_display: displaySourcePath(sourcePath),
        missing_reason: 'ok',
        generated_at: parsed.generatedAt,
        freshness_state: freshnessOf(parsed.generatedAt),
        does_not_establish: parsed.doesNotEstablish,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('enoent') || message.includes('no such file')) {
      return emptyData('missing', 'decision_axis_snapshot_missing', sourcePath);
    }
    return emptyData('corrupt', 'decision_axis_snapshot_corrupt', sourcePath);
  }
}
