import { getAnatomyData } from './anatomy.js';
import { getInsightsData } from './insights.js';
import { getTimelineData } from './timeline.js';
import { getReflexionData } from './reflexion.js';

/**
 * One row of summary data shown on the home dashboard for a single phase view.
 *
 * `source_kind` and `freshness_state` mirror the per-view contracts so a single
 * glance reveals whether data is live ("artifact"), falling back ("fixture") or
 * absent ("missing"), and how recent it is.
 */
export interface DashboardPhase {
  /** Stable id used for testing and CSS hooks. */
  id: 'anatomie' | 'physiologie' | 'zeitachse' | 'erkenntnisse' | 'reflexion';
  /** Roadmap phase number from the visualization blueprint (1–5). */
  phase: number;
  title: string;
  /** Short German description for the card subtitle. */
  description: string;
  /** Target href for the card link. */
  href: string;
  /** Where the displayed data comes from. */
  source_kind: 'artifact' | 'fixture' | 'missing' | 'error';
  /** Freshness verdict on the displayed data (best-effort). */
  freshness_state: 'fresh' | 'stale' | 'unknown';
  /** Human-readable metric to give an at-a-glance pulse. */
  metric: string;
  /** When the underlying load failed, the message goes here. */
  error_reason: string | null;
}

export interface DashboardData {
  phases: DashboardPhase[];
}

/**
 * Maps error messages that contain strict-mode details (e.g. artifact paths) to an
 * opaque token so the dashboard tile never surfaces internal path information.
 * Case-insensitive match to handle variations (Strict, strict, STRICT).
 * Non-strict messages are also mapped to an opaque token; raw errors stay in logs.
 */
function publicErrorReason(msg: string): string {
  return msg.toLowerCase().includes('strict') ? 'strict-load-failed' : 'controller-load-failed';
}

/**
 * Wraps a controller call so an upstream failure becomes a typed error tile
 * instead of crashing the whole dashboard. The home page must always render.
 */
async function safeLoad<T>(name: string, loader: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await loader(), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Dashboard] ${name} load failed:`, msg);
    return { data: null, error: publicErrorReason(msg) };
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const [anatomy, insights, timeline, reflexion] = await Promise.all([
    safeLoad('Anatomy', getAnatomyData),
    safeLoad('Insights', getInsightsData),
    safeLoad('Timeline', getTimelineData),
    safeLoad('Reflexion', getReflexionData),
  ]);

  const phases: DashboardPhase[] = [
    {
      id: 'anatomie',
      phase: 1,
      title: 'Anatomie',
      description: 'Strukturmodell des Organismus – Repos, Beziehungen, Rollen.',
      href: '/anatomy',
      source_kind: anatomy.error ? 'error' : (anatomy.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: anatomy.data?.view_meta.freshness_state ?? 'unknown',
      metric: anatomy.data?.anatomy
        ? `${anatomy.data.anatomy.nodes?.length ?? 0} Knoten · ${anatomy.data.anatomy.edges?.length ?? 0} Kanten`
        : 'keine Strukturdaten',
      error_reason: anatomy.error,
    },
    {
      id: 'physiologie',
      phase: 2,
      title: 'Physiologie',
      description: 'Health-Layer über der Anatomie – Ampelstatus pro Repo.',
      href: '/anatomy',
      source_kind: anatomy.error ? 'error' : anatomy.data?.health.source_kind ?? 'missing',
      freshness_state: anatomy.data?.health.freshness_state ?? 'unknown',
      metric: anatomy.data?.health
        ? `OK ${anatomy.data.health.totals.ok} · Warn ${anatomy.data.health.totals.warn} · Fail ${anatomy.data.health.totals.fail}`
        : 'keine Health-Daten',
      error_reason: anatomy.error,
    },
    {
      id: 'zeitachse',
      phase: 3,
      title: 'Zeitachse',
      description: 'Chronologische Events des Heimgewebes (48 h Fenster).',
      href: '/timeline',
      source_kind: timeline.error ? 'error' : (timeline.data?.view_meta.source_kind === 'chronik' ? 'artifact' : timeline.data?.view_meta.source_kind === 'fixture' ? 'fixture' : 'missing'),
      freshness_state: timeline.data
        ? (timeline.data.events.length > 0 ? 'fresh' : 'unknown')
        : 'unknown',
      metric: timeline.data
        ? `${timeline.data.events.length} Events · ${timeline.data.view_meta.hours_back}h`
        : 'keine Zeitachsendaten',
      error_reason: timeline.error,
    },
    {
      id: 'erkenntnisse',
      phase: 4,
      title: 'Erkenntnisse',
      description: 'Semantische Tagesanalyse – Topics, Fragen, Deltas.',
      href: '/insights',
      source_kind: insights.error ? 'error' : (insights.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: insights.data?.view_meta.freshness_state ?? 'unknown',
      metric: insights.data?.insights
        ? `${insights.data.insights.topics.length} Topics · ${insights.data.insights.questions.length} Fragen · ${insights.data.insights.deltas.length} Deltas`
        : 'keine Erkenntnisse',
      error_reason: insights.error,
    },
    {
      id: 'reflexion',
      phase: 5,
      title: 'Reflexion',
      description: 'Heimgeist-Meta-Analyse – Hypothesen, Drift, Wissenslücken.',
      href: '/reflexion',
      source_kind: reflexion.error ? 'error' : (reflexion.data?.view_meta.source_kind ?? 'missing'),
      freshness_state: reflexion.data?.view_meta.freshness_state ?? 'unknown',
      metric: reflexion.data?.reflexion
        ? `${reflexion.data.reflexion.hypotheses?.length ?? 0} Hypothesen · ${reflexion.data.reflexion.drift_markers?.length ?? 0} Drift-Marker`
        : 'keine Reflexionsdaten',
      error_reason: reflexion.error,
    },
  ];

  return { phases };
}
