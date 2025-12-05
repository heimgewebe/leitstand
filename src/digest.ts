import type { DailyInsights } from './insights.js';
import type { EventLine } from './events.js';
import type { MetricsSnapshot } from './metrics.js';

/**
 * Event summary for the digest
 */
export interface EventSummary {
  timestamp: string;
  kind: string;
  label: string;
}

/**
 * Fleet health summary for the digest
 */
export interface FleetHealth {
  available: boolean;
  timestamp?: string;
  totalRepos: number;
  ok: number;
  warn: number;
  fail: number;
}

/**
 * Complete daily digest
 */
export interface DailyDigest {
  /** Date of the digest (YYYY-MM-DD) */
  date: string;
  /** Top topics from semantic analysis */
  topics: Array<{ topic: string; count: number }>;
  /** Semantic questions */
  questions: string[];
  /** Detected deltas/changes */
  deltas: string[];
  /** Key events from the last 24h */
  events: EventSummary[];
  /** Fleet health metrics */
  fleetHealth: FleetHealth;
}

/**
 * Creates a human-readable label for an event
 */
function createEventLabel(event: EventLine): string {
  const parts: string[] = [event.kind];
  
  if (event.repo) {
    parts.push(event.repo);
  }
  
  if (event.job) {
    parts.push(event.job);
  }
  
  if (event.severity) {
    parts.push(`[${event.severity}]`);
  }
  
  return parts.join(' ');
}

/**
 * Builds a daily digest from all data sources
 * 
 * @param date - Date string (YYYY-MM-DD)
 * @param insights - Daily insights from semantAH
 * @param events - Recent events from chronik
 * @param metrics - Latest metrics snapshot from WGX
 * @param maxEvents - Maximum number of events to include
 * @returns Complete daily digest
 */
export function buildDailyDigest(
  date: string,
  insights: DailyInsights | null,
  events: EventLine[],
  metrics: MetricsSnapshot | null,
  maxEvents: number = 20
): DailyDigest {
  // Process topics
  const topics = insights?.topics.map(([topic, count]) => ({
    topic,
    count,
  })) || [];
  
  // Process events - limit to maxEvents
  const eventSummaries: EventSummary[] = events
    .slice(0, maxEvents)
    .map(event => ({
      timestamp: event.timestamp,
      kind: event.kind,
      label: createEventLabel(event),
    }));
  
  // Process fleet health
  const fleetHealth: FleetHealth = metrics ? {
    available: true,
    timestamp: metrics.timestamp,
    totalRepos: metrics.repoCount,
    ok: metrics.status.ok,
    warn: metrics.status.warn,
    fail: metrics.status.fail,
  } : {
    available: false,
    totalRepos: 0,
    ok: 0,
    warn: 0,
    fail: 0,
  };
  
  return {
    date,
    topics,
    questions: insights?.questions || [],
    deltas: insights?.deltas || [],
    events: eventSummaries,
    fleetHealth,
  };
}
