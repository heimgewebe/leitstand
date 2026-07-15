import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export type StorageTruth = 'observed' | 'estimated' | 'unavailable';
export type StorageHealthSourceKind = 'artifact' | 'fixture' | 'missing' | 'corrupt';
export type StorageHealthFreshness = 'fresh' | 'stale' | 'unknown';

export interface StorageMetric {
  truth: StorageTruth;
  [key: string]: unknown;
}

export interface StorageProducer {
  id: string;
  class: string;
  owner: string;
  sizeBytes: number;
  warningBytes: number;
  hardBytes: number;
  status: string;
  errorCount: number;
  truth: StorageTruth;
}

export interface StorageViolation {
  signal: string;
  status: string;
  detail: string;
  truth: StorageTruth;
}

export interface StorageBlocker {
  id: string;
  class: string;
  reason: string;
  count: number | null;
  truth: StorageTruth;
}

export interface StorageNotification {
  id: string;
  signal: string;
  from: string;
  to: string;
  observedAt: string;
  kind: 'threshold_crossing' | 'recovery';
  message: string;
}

export interface StorageHealthViewData {
  current: {
    observedAt: string;
    filesystem: StorageMetric;
    temporary: StorageMetric;
    growth24h: StorageMetric;
    topProducers: StorageProducer[];
    budgetViolations: StorageViolation[];
    unownedArtifacts: Array<{ path: string; sizeBytes: number; truth: StorageTruth }>;
    cleanupBlockers: StorageBlocker[];
    summary: {
      producerCount: number;
      budgetViolationCount: number;
      cleanupBlockerCount: number;
      unownedArtifactCount: number;
      notificationCount: number;
    };
  } | null;
  notifications: StorageNotification[];
  view_meta: {
    source_kind: StorageHealthSourceKind;
    source_path: string;
    source_path_display: string;
    missing_reason: string;
    generated_at: string | null;
    freshness_state: StorageHealthFreshness;
    hourly_count: number;
    hourly_max: number;
    daily_count: number;
    daily_max: number;
    notification_count: number;
    notification_max: number;
    observed_count: number;
    estimated_count: number;
    unavailable_count: number;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_storage_health';
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const CONTRACT_LIMITS = Object.freeze({
  hourly: 744,
  daily: 366,
  notifications: 512,
  producers: 512,
  unownedArtifacts: 512,
  blockers: 513,
  violations: 514,
});
const DEFAULT_NON_CLAIMS = [
  'cleanup_authority',
  'deletion_permission',
  'complete_process_observation',
  'future_storage_growth',
];
const TRUTH_VALUES = new Set<StorageTruth>(['observed', 'estimated', 'unavailable']);

function artifactPath(): string {
  return process.env.LEITSTAND_STORAGE_HEALTH_PATH
    || join(process.cwd(), 'artifacts', 'storage-health.json');
}

function fixturePath(): string {
  return join(process.cwd(), 'src', 'fixtures', 'storage-health.json');
}

function fixtureFallbackEnabled(): boolean {
  const explicit = process.env.LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK;
  if (explicit !== undefined) return explicit === '1' || explicit.toLowerCase() === 'true';
  return process.env.LEITSTAND_STRICT === '0' || process.env.LEITSTAND_STRICT === 'false';
}

function classifyError(error: unknown): { kind: StorageHealthSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'storage_health_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('mismatch')) {
    return { kind: 'corrupt', reason: 'storage_health_corrupt' };
  }
  return { kind: 'corrupt', reason: 'storage_health_load_failed' };
}

function freshnessOf(generatedAt: string | null): StorageHealthFreshness {
  if (!generatedAt) return 'unknown';
  const timestamp = Date.parse(generatedAt);
  if (Number.isNaN(timestamp)) return 'unknown';
  return Date.now() - timestamp <= STALE_AFTER_MS ? 'fresh' : 'stale';
}

function displaySourcePath(sourcePath: string): string {
  const rel = relative(resolve(process.cwd()), resolve(sourcePath));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external snapshot>';
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid ${label}: object required`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${label}`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  const number = numberValue(value, label);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`invalid ${label}: expected integer <= ${maximum}`);
  }
  return number;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid ${label}`);
  return value;
}

function truthValue(value: unknown, label: string): StorageTruth {
  if (typeof value !== 'string' || !TRUTH_VALUES.has(value as StorageTruth)) {
    throw new Error(`invalid ${label} truth`);
  }
  return value as StorageTruth;
}

function parseProducer(value: unknown, label: string): StorageProducer {
  const producer = objectValue(value, label);
  return {
    id: stringValue(producer.id, `${label}.id`),
    class: stringValue(producer.class, `${label}.class`),
    owner: stringValue(producer.owner, `${label}.owner`),
    sizeBytes: numberValue(producer.sizeBytes, `${label}.sizeBytes`),
    warningBytes: numberValue(producer.warningBytes, `${label}.warningBytes`),
    hardBytes: numberValue(producer.hardBytes, `${label}.hardBytes`),
    status: stringValue(producer.status, `${label}.status`),
    errorCount: numberValue(producer.errorCount, `${label}.errorCount`),
    truth: truthValue(producer.truth, label),
  };
}

function parseViolation(value: unknown, label: string): StorageViolation {
  const violation = objectValue(value, label);
  return {
    signal: stringValue(violation.signal, `${label}.signal`),
    status: stringValue(violation.status, `${label}.status`),
    detail: stringValue(violation.detail, `${label}.detail`),
    truth: truthValue(violation.truth, label),
  };
}

function parseBlocker(value: unknown, label: string): StorageBlocker {
  const blocker = objectValue(value, label);
  return {
    id: stringValue(blocker.id, `${label}.id`),
    class: stringValue(blocker.class, `${label}.class`),
    reason: stringValue(blocker.reason, `${label}.reason`),
    count: nullableNumber(blocker.count, `${label}.count`),
    truth: truthValue(blocker.truth, label),
  };
}

function parseNotification(value: unknown, label: string): StorageNotification {
  const notification = objectValue(value, label);
  const kind = stringValue(notification.kind, `${label}.kind`);
  if (kind !== 'threshold_crossing' && kind !== 'recovery') throw new Error(`invalid ${label}.kind`);
  return {
    id: stringValue(notification.id, `${label}.id`),
    signal: stringValue(notification.signal, `${label}.signal`),
    from: stringValue(notification.from, `${label}.from`),
    to: stringValue(notification.to, `${label}.to`),
    observedAt: stringValue(notification.observedAt, `${label}.observedAt`),
    kind,
    message: stringValue(notification.message, `${label}.message`),
  };
}

function assertIncreasing(values: unknown[], key: string, label: string): void {
  let previous: string | null = null;
  for (const raw of values) {
    const item = objectValue(raw, label);
    const current = stringValue(item[key], `${label}.${key}`);
    if (previous !== null && current <= previous) throw new Error(`invalid ${label}: not strictly increasing`);
    previous = current;
  }
}

function countTruth(value: unknown, counts: Record<StorageTruth, number>): void {
  if (Array.isArray(value)) {
    for (const item of value) countTruth(item, counts);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (typeof item.truth === 'string' && TRUTH_VALUES.has(item.truth as StorageTruth)) {
    counts[item.truth as StorageTruth] += 1;
  }
  for (const child of Object.values(item)) countTruth(child, counts);
}

function parseSnapshot(raw: unknown): {
  current: NonNullable<StorageHealthViewData['current']>;
  notifications: StorageNotification[];
  generatedAt: string;
  retention: { hourlyMax: number; dailyMax: number; notificationMax: number };
  hourlyCount: number;
  dailyCount: number;
  truths: Record<StorageTruth, number>;
  doesNotEstablish: string[];
} {
  const root = objectValue(raw, 'storage health root');
  if (root.schemaVersion !== 1 || root.kind !== CONTRACT_KIND) {
    throw new Error('storage health kind or schemaVersion mismatch');
  }
  const generatedAt = stringValue(root.generatedAt, 'storage health generatedAt');
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error('invalid storage health generatedAt');
  const retention = objectValue(root.retention, 'storage health retention');
  const hourlyMax = boundedInteger(retention.hourlyMax, 'retention.hourlyMax', CONTRACT_LIMITS.hourly);
  const dailyMax = boundedInteger(retention.dailyMax, 'retention.dailyMax', CONTRACT_LIMITS.daily);
  const notificationMax = boundedInteger(
    retention.notificationMax,
    'retention.notificationMax',
    CONTRACT_LIMITS.notifications,
  );
  const hourly = Array.isArray(root.hourly) ? root.hourly : null;
  const daily = Array.isArray(root.daily) ? root.daily : null;
  const rawNotifications = Array.isArray(root.notifications) ? root.notifications : null;
  if (!hourly || !daily || !rawNotifications) throw new Error('invalid storage health bounded series');
  if (hourly.length > hourlyMax || daily.length > dailyMax || rawNotifications.length > notificationMax) {
    throw new Error('invalid storage health retention bound');
  }
  assertIncreasing(hourly, 'bucket', 'hourly series');
  assertIncreasing(daily, 'date', 'daily series');
  for (const [index, rawEntry] of daily.entries()) {
    const entry = objectValue(rawEntry, `daily[${index}]`);
    if (!Array.isArray(entry.producers) || entry.producers.length > CONTRACT_LIMITS.producers) {
      throw new Error(`invalid daily[${index}].producers payload bound`);
    }
    if (!Array.isArray(entry.unownedArtifacts)
      || entry.unownedArtifacts.length > CONTRACT_LIMITS.unownedArtifacts) {
      throw new Error(`invalid daily[${index}].unownedArtifacts payload bound`);
    }
  }

  const current = objectValue(root.current, 'storage health current');
  const filesystem = objectValue(current.filesystem, 'current.filesystem');
  const temporary = objectValue(current.temporary, 'current.temporary');
  const growth24h = objectValue(current.growth24h, 'current.growth24h');
  const summary = objectValue(current.summary, 'current.summary');
  if (!Array.isArray(current.topProducers) || current.topProducers.length > 10) {
    throw new Error('invalid current.topProducers payload bound');
  }
  const topProducers = current.topProducers
    .map((item, index) => parseProducer(item, `topProducers[${index}]`));
  if (!Array.isArray(current.budgetViolations)
    || current.budgetViolations.length > CONTRACT_LIMITS.violations) {
    throw new Error('invalid current.budgetViolations payload bound');
  }
  const budgetViolations = current.budgetViolations
    .map((item, index) => parseViolation(item, `budgetViolations[${index}]`));
  if (!Array.isArray(current.cleanupBlockers)
    || current.cleanupBlockers.length > CONTRACT_LIMITS.blockers) {
    throw new Error('invalid current.cleanupBlockers payload bound');
  }
  const cleanupBlockers = current.cleanupBlockers
    .map((item, index) => parseBlocker(item, `cleanupBlockers[${index}]`));
  if (!Array.isArray(current.unownedArtifacts)
    || current.unownedArtifacts.length > CONTRACT_LIMITS.unownedArtifacts) {
    throw new Error('invalid current.unownedArtifacts payload bound');
  }
  const unownedArtifacts = current.unownedArtifacts.map((item, index) => {
      const artifact = objectValue(item, `unownedArtifacts[${index}]`);
      return {
        path: stringValue(artifact.path, `unownedArtifacts[${index}].path`),
        sizeBytes: numberValue(artifact.sizeBytes, `unownedArtifacts[${index}].sizeBytes`),
        truth: truthValue(artifact.truth, `unownedArtifacts[${index}]`),
      };
    });
  const parsedCurrent: NonNullable<StorageHealthViewData['current']> = {
    observedAt: stringValue(current.observedAt, 'current.observedAt'),
    filesystem: {
      path: stringValue(filesystem.path, 'current.filesystem.path'),
      totalBytes: numberValue(filesystem.totalBytes, 'current.filesystem.totalBytes'),
      usedBytes: numberValue(filesystem.usedBytes, 'current.filesystem.usedBytes'),
      availableBytes: numberValue(filesystem.availableBytes, 'current.filesystem.availableBytes'),
      usedPercent: numberValue(filesystem.usedPercent, 'current.filesystem.usedPercent'),
      status: stringValue(filesystem.status, 'current.filesystem.status'),
      truth: truthValue(filesystem.truth, 'current.filesystem'),
    },
    temporary: {
      usedBytes: numberValue(temporary.usedBytes, 'current.temporary.usedBytes'),
      status: stringValue(temporary.status, 'current.temporary.status'),
      truth: truthValue(temporary.truth, 'current.temporary'),
    },
    growth24h: {
      bytes: nullableNumber(growth24h.bytes, 'current.growth24h.bytes'),
      percent: nullableNumber(growth24h.percent, 'current.growth24h.percent'),
      baselineAt: growth24h.baselineAt === null
        ? null
        : stringValue(growth24h.baselineAt, 'current.growth24h.baselineAt'),
      truth: truthValue(growth24h.truth, 'current.growth24h'),
    },
    topProducers,
    budgetViolations,
    unownedArtifacts,
    cleanupBlockers,
    summary: {
      producerCount: numberValue(summary.producerCount, 'current.summary.producerCount'),
      budgetViolationCount: numberValue(summary.budgetViolationCount, 'current.summary.budgetViolationCount'),
      cleanupBlockerCount: numberValue(summary.cleanupBlockerCount, 'current.summary.cleanupBlockerCount'),
      unownedArtifactCount: numberValue(summary.unownedArtifactCount, 'current.summary.unownedArtifactCount'),
      notificationCount: numberValue(summary.notificationCount, 'current.summary.notificationCount'),
    },
  };
  const notifications = rawNotifications.map((item, index) => parseNotification(item, `notifications[${index}]`));
  const truths: Record<StorageTruth, number> = { observed: 0, estimated: 0, unavailable: 0 };
  countTruth(parsedCurrent, truths);
  const doesNotEstablish = Array.isArray(root.doesNotEstablish)
    ? root.doesNotEstablish.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  return {
    current: parsedCurrent,
    notifications: [...notifications].sort((left, right) => right.observedAt.localeCompare(left.observedAt)),
    generatedAt,
    retention: { hourlyMax, dailyMax, notificationMax },
    hourlyCount: hourly.length,
    dailyCount: daily.length,
    truths,
    doesNotEstablish: doesNotEstablish.length > 0 ? doesNotEstablish : DEFAULT_NON_CLAIMS,
  };
}

function emptyData(kind: StorageHealthSourceKind, reason: string, sourcePath: string): StorageHealthViewData {
  return {
    current: null,
    notifications: [],
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: reason,
      generated_at: null,
      freshness_state: 'unknown',
      hourly_count: 0,
      hourly_max: 0,
      daily_count: 0,
      daily_max: 0,
      notification_count: 0,
      notification_max: 0,
      observed_count: 0,
      estimated_count: 0,
      unavailable_count: 1,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function dataFromParsed(
  parsed: ReturnType<typeof parseSnapshot>,
  sourceKind: StorageHealthSourceKind,
  sourcePath: string,
  missingReason: string,
): StorageHealthViewData {
  return {
    current: parsed.current,
    notifications: parsed.notifications,
    view_meta: {
      source_kind: sourceKind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: missingReason,
      generated_at: parsed.generatedAt,
      freshness_state: freshnessOf(parsed.generatedAt),
      hourly_count: parsed.hourlyCount,
      hourly_max: parsed.retention.hourlyMax,
      daily_count: parsed.dailyCount,
      daily_max: parsed.retention.dailyMax,
      notification_count: parsed.notifications.length,
      notification_max: parsed.retention.notificationMax,
      observed_count: parsed.truths.observed,
      estimated_count: parsed.truths.estimated,
      unavailable_count: parsed.truths.unavailable,
      does_not_establish: parsed.doesNotEstablish,
    },
  };
}

async function loadSnapshot(path: string): Promise<ReturnType<typeof parseSnapshot>> {
  return parseSnapshot(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function getStorageHealthData(): Promise<StorageHealthViewData> {
  const sourcePath = resolve(artifactPath());
  try {
    return dataFromParsed(await loadSnapshot(sourcePath), 'artifact', sourcePath, 'ok');
  } catch (error) {
    const classified = classifyError(error);
    const envOverride = process.env.LEITSTAND_STORAGE_HEALTH_PATH !== undefined;
    if (envOverride || classified.kind !== 'missing' || !fixtureFallbackEnabled()) {
      return emptyData(classified.kind, classified.reason, sourcePath);
    }
    const fallbackPath = resolve(fixturePath());
    try {
      return dataFromParsed(
        await loadSnapshot(fallbackPath),
        'fixture',
        fallbackPath,
        'storage_health_missing_fixture_fallback',
      );
    } catch (fallbackError) {
      const fallbackClassified = classifyError(fallbackError);
      return emptyData(fallbackClassified.kind, fallbackClassified.reason, fallbackPath);
    }
  }
}
