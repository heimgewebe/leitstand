import type { DailyInsights, Topic } from './insights.js';

/**
 * A topic whose semantic weight changed between two daily insight artifacts.
 */
export interface TopicDelta {
  name: string;
  /** Score in the previous (Vortag) artifact. */
  previous: number;
  /** Score in the current (today) artifact. */
  current: number;
  /** current - previous, rounded to 4 decimals to suppress float noise. */
  diff: number;
  direction: 'up' | 'down';
}

/**
 * A topic that only exists on one of the two compared days.
 */
export interface TopicEntry {
  name: string;
  score: number;
}

/**
 * Structured, data-bound day-over-day comparison between two `insights.daily`
 * artifacts. Unlike the producer-supplied `deltas[]` (free-text), this is
 * computed by Leitstand purely from the two payloads, so every entry is
 * traceable to a concrete topic/question in a concrete dated artifact.
 *
 * This is strictly observational: it reads two artifacts and reports the
 * difference. It never mutates or generates source data.
 */
export interface DayComparison {
  /** ISO date of the current artifact, or null when absent. */
  current_ts: string | null;
  /** ISO date of the previous artifact, or null when absent. */
  previous_ts: string | null;
  topics: {
    /** Present today, absent yesterday. */
    added: TopicEntry[];
    /** Present yesterday, absent today. */
    removed: TopicEntry[];
    /** Present both days with a changed score. */
    changed: TopicDelta[];
    /** Count of topics present both days with an unchanged score. */
    unchanged: number;
  };
  questions: {
    /** Open today, not present yesterday. */
    added: string[];
    /** Present yesterday, no longer present today. */
    resolved: string[];
  };
  /** True when any topic or question differs between the two days. */
  has_changes: boolean;
}

/**
 * Scores are floats in [0, 1]; differences below this epsilon are treated as
 * "unchanged" so float representation noise is not reported as a delta.
 */
const SCORE_CHANGE_EPSILON = 1e-6;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Builds a name → score lookup, keeping the first occurrence of a name so the
 * comparison reflects the top-ranked instance when a producer emits duplicates.
 */
function toScoreMap(topics: Topic[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [name, score] of topics) {
    if (!map.has(name)) {
      map.set(name, score);
    }
  }
  return map;
}

function diffQuestions(
  current: string[],
  previous: string[],
): { added: string[]; resolved: string[] } {
  const currentSet = new Set(current.map((q) => q.trim()).filter((q) => q.length > 0));
  const previousSet = new Set(previous.map((q) => q.trim()).filter((q) => q.length > 0));

  const added: string[] = [];
  const seenAdded = new Set<string>();
  for (const question of current) {
    const key = question.trim();
    if (key.length === 0 || previousSet.has(key) || seenAdded.has(key)) {
      continue;
    }
    seenAdded.add(key);
    added.push(question);
  }

  const resolved: string[] = [];
  const seenResolved = new Set<string>();
  for (const question of previous) {
    const key = question.trim();
    if (key.length === 0 || currentSet.has(key) || seenResolved.has(key)) {
      continue;
    }
    seenResolved.add(key);
    resolved.push(question);
  }

  return { added, resolved };
}

/**
 * Computes the day-over-day delta between today's and the previous day's
 * sanitized daily insights.
 *
 * Matching is by exact topic name and trimmed question text. Topic ordering:
 * added/removed by score descending, changed by absolute delta descending, each
 * with a stable name tie-breaker; question ordering follows the source artifact.
 */
export function compareInsights(current: DailyInsights, previous: DailyInsights): DayComparison {
  const currentMap = toScoreMap(current.topics);
  const previousMap = toScoreMap(previous.topics);

  const added: TopicEntry[] = [];
  const changed: TopicDelta[] = [];
  let unchanged = 0;

  for (const [name, currentScore] of currentMap) {
    const previousScore = previousMap.get(name);
    if (previousScore === undefined) {
      added.push({ name, score: currentScore });
      continue;
    }

    const rawDiff = currentScore - previousScore;
    if (Math.abs(rawDiff) <= SCORE_CHANGE_EPSILON) {
      unchanged += 1;
    } else {
      changed.push({
        name,
        previous: previousScore,
        current: currentScore,
        diff: roundTo(rawDiff, 4),
        direction: rawDiff > 0 ? 'up' : 'down',
      });
    }
  }

  const removed: TopicEntry[] = [];
  for (const [name, score] of previousMap) {
    if (!currentMap.has(name)) {
      removed.push({ name, score });
    }
  }

  added.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  removed.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  changed.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));

  const questions = diffQuestions(current.questions, previous.questions);

  const hasChanges =
    added.length > 0 ||
    removed.length > 0 ||
    changed.length > 0 ||
    questions.added.length > 0 ||
    questions.resolved.length > 0;

  return {
    current_ts: current.ts.trim() !== '' ? current.ts.trim() : null,
    previous_ts: previous.ts.trim() !== '' ? previous.ts.trim() : null,
    topics: { added, removed, changed, unchanged },
    questions,
    has_changes: hasChanges,
  };
}

/**
 * Returns the ISO date (YYYY-MM-DD) of the day before `ts`, or null when `ts`
 * is not a valid calendar date. Used to locate the previous day's artifact.
 */
export function previousDateOf(ts: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ts.trim());
  if (!match) {
    return null;
  }

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // Reject values that JS rolled over (e.g. 2025-13-40) so we only ever derive
  // a previous date from a genuine calendar date.
  const roundTrip = date.toISOString().slice(0, 10);
  if (roundTrip !== `${match[1]}-${match[2]}-${match[3]}`) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
