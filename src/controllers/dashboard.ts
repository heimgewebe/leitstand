import { getBureauData } from './bureau.js';
import { getCheckoutData } from './checkouts.js';
import { getStorageHealthData } from './storageHealth.js';
import { getEcosystemMapData } from './ecosystemMap.js';
import { getRepoBriefData } from './repoBrief.js';

export interface DashboardSource {
  id: string;
  title: string;
  description: string;
  href: string;
  source_kind: 'artifact' | 'fixture' | 'missing' | 'error' | 'corrupt';
  freshness_state: 'fresh' | 'stale' | 'unknown';
  metric: string;
  error_reason: string | null;
}

export interface DashboardAttentionItem {
  source_id: DashboardSource['id'];
  title: string;
  href: string;
  severity: 'critical' | 'warning' | 'info';
  reason: string;
}

export interface DashboardSummary {
  state: 'healthy' | 'attention' | 'critical';
  state_label: 'Stabil' | 'Prüfbedarf' | 'Kritisch';
  headline: string;
  total_count: number;
  verified_fresh_count: number;
  attention_count: number;
  unavailable_count: number;
  attention: DashboardAttentionItem[];
}

export interface DashboardData {
  sources: DashboardSource[];
  summary: DashboardSummary;
}

function publicErrorReason(msg: string): string {
  return msg.toLowerCase().includes('strict') ? 'strict-load-failed' : 'controller-load-failed';
}

async function safeLoad<T>(name: string, loader: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await loader(), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Dashboard] ${name} load failed:`, msg);
    return { data: null, error: publicErrorReason(msg) };
  }
}

function summarizeSource(source: DashboardSource): DashboardAttentionItem | null {
  if (source.source_kind === 'error') {
    return {
      source_id: source.id,
      title: source.title,
      href: source.href,
      severity: 'critical',
      reason: 'Datenquelle konnte nicht geladen werden',
    };
  }

  if (source.source_kind === 'missing' || source.source_kind === 'corrupt') {
    return {
      source_id: source.id,
      title: source.title,
      href: source.href,
      severity: 'critical',
      reason: 'Keine belastbare Datenquelle verfügbar',
    };
  }

  const reasons: string[] = [];
  let severity: DashboardAttentionItem['severity'] = 'info';

  if (source.source_kind === 'fixture') {
    reasons.push('Ersatzdaten statt eines Artefakts');
    severity = 'warning';
  }
  if (source.freshness_state === 'stale') {
    reasons.push('Daten sind veraltet');
    severity = 'warning';
  } else if (source.freshness_state === 'unknown') {
    reasons.push('Datenfrische ist nicht belegt');
  }

  if (reasons.length === 0) return null;

  return {
    source_id: source.id,
    title: source.title,
    href: source.href,
    severity,
    reason: reasons.join(' · '),
  };
}

export function summarizeDashboard(sources: DashboardSource[]): DashboardSummary {
  const severityRank: Record<DashboardAttentionItem['severity'], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const attention = sources
    .map(summarizeSource)
    .filter((item): item is DashboardAttentionItem => item !== null)
    .sort((left, right) => severityRank[left.severity] - severityRank[right.severity]
      || sources.findIndex((s) => s.id === left.source_id) - sources.findIndex((s) => s.id === right.source_id));
  const unavailableCount = sources.filter((s) => s.source_kind === 'missing' || s.source_kind === 'error' || s.source_kind === 'corrupt').length;
  const verifiedFreshCount = sources.filter((s) => s.source_kind === 'artifact' && s.freshness_state === 'fresh').length;
  const hasCritical = attention.some((item) => item.severity === 'critical');

  if (hasCritical) {
    return {
      state: 'critical',
      state_label: 'Kritisch',
      headline: `${unavailableCount} ${unavailableCount === 1 ? 'Bereich liefert' : 'Bereiche liefern'} keine belastbaren Daten`,
      total_count: sources.length,
      verified_fresh_count: verifiedFreshCount,
      attention_count: attention.length,
      unavailable_count: unavailableCount,
      attention,
    };
  }

  if (attention.length > 0) {
    return {
      state: 'attention',
      state_label: 'Prüfbedarf',
      headline: `${attention.length} ${attention.length === 1 ? 'Bereich benötigt' : 'Bereiche benötigen'} Prüfung`,
      total_count: sources.length,
      verified_fresh_count: verifiedFreshCount,
      attention_count: attention.length,
      unavailable_count: unavailableCount,
      attention,
    };
  }

  return {
    state: 'healthy',
    state_label: 'Stabil',
    headline: 'Alle Bereiche liefern frische Artefakte',
    total_count: sources.length,
    verified_fresh_count: verifiedFreshCount,
    attention_count: 0,
    unavailable_count: 0,
    attention: [],
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const [bureau, checkouts, storage, eco, repo] = await Promise.all([
    safeLoad('Bureau', getBureauData),
    safeLoad('Checkouts', getCheckoutData),
    safeLoad('Storage', getStorageHealthData),
    safeLoad('Ecosystem', getEcosystemMapData),
    safeLoad('RepoGround', getRepoBriefData),
  ]);

  const sources: DashboardSource[] = [
    {
      id: 'bureau',
      title: 'Bureau',
      description: 'Task- und Claim-Projektion.',
      href: '/bureau',
      source_kind: bureau.error ? 'error' : (bureau.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: bureau.data?.view_meta.freshness_state ?? 'unknown',
      metric: bureau.data ? `${bureau.data.view_meta.task_count} Tasks` : 'keine Tasks',
      error_reason: bureau.error,
    },
    {
      id: 'checkouts',
      title: 'Checkouts',
      description: 'Grabowski-Inventar.',
      href: '/checkouts',
      source_kind: checkouts.error ? 'error' : (checkouts.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: checkouts.data?.view_meta.freshness_state ?? 'unknown',
      metric: checkouts.data ? `${checkouts.data.view_meta.checkout_count} Checkouts` : 'keine Checkouts',
      error_reason: checkouts.error,
    },
    {
      id: 'storage_health',
      title: 'Speicherzustand',
      description: 'Heim-PC Storage Metriken.',
      href: '/storage-health',
      source_kind: storage.error ? 'error' : (storage.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: storage.data?.view_meta.freshness_state ?? 'unknown',
      metric: storage.data?.current ? `${storage.data.current.summary.producerCount} Producer` : 'kein Storage Zustand',
      error_reason: storage.error,
    },
    {
      id: 'ecosystem_map',
      title: 'Systemkarte',
      description: 'Systemkatalog Map Manifest.',
      href: '/ecosystem-map',
      source_kind: eco.error ? 'error' : (eco.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: eco.data?.view_meta.freshness_state ?? 'unknown',
      metric: eco.data ? `${eco.data.view_meta.verified_artifact_count} Artefakte` : 'keine Systemkarte',
      error_reason: eco.error,
    },
    {
      id: 'repo_ground',
      title: 'RepoGround',
      description: 'Bundle-Ansicht.',
      href: '/repoground',
      source_kind: repo.error ? 'error' : (repo.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: repo.data?.view_meta.freshness_state ?? 'unknown',
      metric: repo.data ? `${repo.data.bundles.length} Bundles` : 'keine Repos',
      error_reason: repo.error,
    }
  ];

  return { sources, summary: summarizeDashboard(sources) };
}
