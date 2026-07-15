#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTRACT_KIND = 'leitstand_storage_health';
export const CONTRACT_VERSION = 1;
export const DEFAULT_LIMITS = Object.freeze({ hourlyMax: 168, dailyMax: 90, notificationMax: 128 });
const MAX_LIMITS = Object.freeze({ hourlyMax: 24 * 31, dailyMax: 366, notificationMax: 512 });
const PAYLOAD_LIMITS = Object.freeze({
  producers: 512,
  unownedArtifacts: 512,
  maintenanceClasses: 256,
  blockers: 513,
  violations: 514,
});
const ALERT_STATUSES = new Set(['notice', 'warning', 'hard_limit', 'critical', 'degraded']);
const SAFE_STATUS = 'ok';

function canonicalJson(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function stringValue(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeStatus(value) {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

function toIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function hourBucket(iso) {
  const date = new Date(iso);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function dayBucket(iso) {
  return iso.slice(0, 10);
}

function assertLimit(value, label, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function normalizeLimits(raw = DEFAULT_LIMITS) {
  return {
    hourlyMax: assertLimit(raw.hourlyMax ?? DEFAULT_LIMITS.hourlyMax, 'hourlyMax', MAX_LIMITS.hourlyMax),
    dailyMax: assertLimit(raw.dailyMax ?? DEFAULT_LIMITS.dailyMax, 'dailyMax', MAX_LIMITS.dailyMax),
    notificationMax: assertLimit(
      raw.notificationMax ?? DEFAULT_LIMITS.notificationMax,
      'notificationMax',
      MAX_LIMITS.notificationMax,
    ),
  };
}

function validateInventory(raw) {
  const inventory = assertObject(raw, 'inventory');
  if (inventory.schema_version !== 1 || inventory.kind !== 'heim_pc.storage_inventory') {
    throw new Error('inventory kind or schema_version mismatch');
  }
  const generatedAt = toIso(stringValue(inventory.generated_at, 'inventory.generated_at'), 'inventory.generated_at');
  const filesystem = assertObject(inventory.filesystem, 'inventory.filesystem');
  const producers = assertArrayBound(inventory.producers, PAYLOAD_LIMITS.producers, 'inventory.producers');
  const summary = assertObject(inventory.summary, 'inventory.summary');
  const normalizedProducers = producers.map((rawProducer, index) => {
    const producer = assertObject(rawProducer, `inventory.producers[${index}]`);
    const budget = assertObject(producer.budget_bytes, `inventory.producers[${index}].budget_bytes`);
    return {
      id: stringValue(producer.id, `inventory.producers[${index}].id`),
      class: stringValue(producer.class, `inventory.producers[${index}].class`),
      owner: stringValue(producer.owner, `inventory.producers[${index}].owner`),
      sizeBytes: nonNegativeNumber(producer.size_bytes, `inventory.producers[${index}].size_bytes`),
      warningBytes: nonNegativeNumber(budget.warning, `inventory.producers[${index}].budget_bytes.warning`),
      hardBytes: nonNegativeNumber(budget.hard, `inventory.producers[${index}].budget_bytes.hard`),
      status: normalizeStatus(producer.status),
      errorCount: nonNegativeNumber(producer.error_count ?? 0, `inventory.producers[${index}].error_count`),
    };
  });
  const unowned = inventory.unowned_candidates === undefined
    ? []
    : assertArrayBound(inventory.unowned_candidates, PAYLOAD_LIMITS.unownedArtifacts, 'inventory.unowned_candidates');
  return {
    raw: inventory,
    generatedAt,
    inventorySha256: optionalString(inventory.inventory_sha256) ?? digest(inventory),
    host: optionalString(inventory.host),
    filesystem: {
      path: stringValue(filesystem.path, 'inventory.filesystem.path'),
      totalBytes: nonNegativeNumber(filesystem.total_bytes, 'inventory.filesystem.total_bytes'),
      usedBytes: nonNegativeNumber(filesystem.used_bytes, 'inventory.filesystem.used_bytes'),
      availableBytes: nonNegativeNumber(filesystem.available_bytes, 'inventory.filesystem.available_bytes'),
      usedPercent: nonNegativeNumber(filesystem.used_percent, 'inventory.filesystem.used_percent'),
      status: normalizeStatus(filesystem.status),
    },
    temporary: {
      usedBytes: nonNegativeNumber(inventory.temporary_total_bytes, 'inventory.temporary_total_bytes'),
      status: normalizeStatus(inventory.temporary_status),
    },
    producers: normalizedProducers,
    unownedArtifacts: unowned.map((candidate, index) => {
      const value = assertObject(candidate, `inventory.unowned_candidates[${index}]`);
      return {
        path: stringValue(value.path, `inventory.unowned_candidates[${index}].path`),
        sizeBytes: nonNegativeNumber(value.size_bytes ?? 0, `inventory.unowned_candidates[${index}].size_bytes`),
        truth: 'observed',
      };
    }),
    summary: {
      warningCount: nonNegativeNumber(summary.warning_count ?? 0, 'inventory.summary.warning_count'),
      hardLimitCount: nonNegativeNumber(summary.hard_limit_count ?? 0, 'inventory.summary.hard_limit_count'),
      degradedCount: nonNegativeNumber(summary.degraded_count ?? 0, 'inventory.summary.degraded_count'),
      unownedCandidateCount: nonNegativeNumber(
        summary.unowned_candidate_count ?? unowned.length,
        'inventory.summary.unowned_candidate_count',
      ),
    },
    doesNotEstablish: Array.isArray(inventory.does_not_establish)
      ? inventory.does_not_establish.filter((item) => typeof item === 'string')
      : [],
  };
}

function validateMaintenancePlan(raw) {
  if (raw === null || raw === undefined) return null;
  const plan = assertObject(raw, 'maintenance plan');
  if (plan.schema_version !== 1 || plan.kind !== 'heim_pc.cache_maintenance_plan') {
    throw new Error('maintenance plan kind or schema_version mismatch');
  }
  const classes = assertObject(plan.classes, 'maintenance plan classes');
  if (Object.keys(classes).length > PAYLOAD_LIMITS.maintenanceClasses) {
    throw new Error(`maintenance plan classes exceed hard payload limit ${PAYLOAD_LIMITS.maintenanceClasses}`);
  }
  const processObservation = assertObject(plan.process_observation, 'maintenance plan process_observation');
  const generatedAtUnix = nonNegativeNumber(plan.generated_at_unix, 'maintenance plan generated_at_unix');
  return {
    raw: plan,
    generatedAt: new Date(generatedAtUnix * 1000).toISOString(),
    planId: stringValue(plan.plan_id, 'maintenance plan plan_id'),
    planSha256: stringValue(plan.plan_sha256, 'maintenance plan plan_sha256'),
    processComplete: processObservation.complete === true,
    processErrorCount: Array.isArray(processObservation.errors) ? processObservation.errors.length : 0,
    classes,
  };
}

function assertArrayBound(value, maximum, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > maximum) throw new Error(`${label} exceeds hard payload limit ${maximum}`);
  return value;
}

function validateStrictlyIncreasing(items, key, label) {
  let previous = null;
  const seen = new Set();
  for (const item of items) {
    const value = stringValue(item?.[key], `${label}.${key}`);
    if (seen.has(value) || (previous !== null && value <= previous)) {
      throw new Error(`${label} must be strictly increasing and unique by ${key}`);
    }
    seen.add(value);
    previous = value;
  }
}

export function validateExistingContract(raw) {
  const contract = assertObject(raw, 'existing storage health contract');
  if (contract.schemaVersion !== CONTRACT_VERSION || contract.kind !== CONTRACT_KIND) {
    throw new Error('existing storage health contract kind or schemaVersion mismatch');
  }
  const retention = normalizeLimits(assertObject(contract.retention, 'existing retention'));
  const hourly = Array.isArray(contract.hourly) ? contract.hourly : null;
  const daily = Array.isArray(contract.daily) ? contract.daily : null;
  const notifications = Array.isArray(contract.notifications) ? contract.notifications : null;
  if (!hourly || !daily || !notifications) throw new Error('existing bounded series must be arrays');
  if (hourly.length > retention.hourlyMax) throw new Error('existing hourly series exceeds retention');
  if (daily.length > retention.dailyMax) throw new Error('existing daily series exceeds retention');
  if (notifications.length > retention.notificationMax) throw new Error('existing notifications exceed retention');
  validateStrictlyIncreasing(hourly, 'bucket', 'existing hourly series');
  validateStrictlyIncreasing(daily, 'date', 'existing daily series');
  for (const [index, rawEntry] of daily.entries()) {
    const entry = assertObject(rawEntry, `existing daily series[${index}]`);
    assertArrayBound(entry.producers, PAYLOAD_LIMITS.producers, `existing daily series[${index}].producers`);
    assertArrayBound(
      entry.unownedArtifacts,
      PAYLOAD_LIMITS.unownedArtifacts,
      `existing daily series[${index}].unownedArtifacts`,
    );
  }
  const current = assertObject(contract.current, 'existing current');
  assertArrayBound(current.topProducers, 10, 'existing current.topProducers');
  assertArrayBound(current.budgetViolations, PAYLOAD_LIMITS.violations, 'existing current.budgetViolations');
  assertArrayBound(current.cleanupBlockers, PAYLOAD_LIMITS.blockers, 'existing current.cleanupBlockers');
  assertArrayBound(current.unownedArtifacts, PAYLOAD_LIMITS.unownedArtifacts, 'existing current.unownedArtifacts');
  const alertState = contract.alertState && typeof contract.alertState === 'object' && !Array.isArray(contract.alertState)
    ? contract.alertState
    : {};
  if (Object.keys(alertState).length > PAYLOAD_LIMITS.violations) {
    throw new Error(`existing alertState exceeds hard payload limit ${PAYLOAD_LIMITS.violations}`);
  }
  return { ...contract, retention, hourly, daily, notifications, alertState };
}

function replaceBucket(items, key, entry, maximum) {
  const next = items.filter((item) => item[key] !== entry[key]);
  next.push(entry);
  next.sort((left, right) => left[key].localeCompare(right[key]));
  return next.slice(-maximum);
}

function buildGrowth(hourly, current) {
  const target = Date.parse(current.bucket) - 24 * 60 * 60 * 1000;
  const candidates = hourly
    .filter((item) => item.bucket !== current.bucket)
    .map((item) => ({ item, distance: Math.abs(Date.parse(item.bucket) - target) }))
    .filter(({ distance }) => Number.isFinite(distance) && distance <= 3 * 60 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance);
  if (candidates.length === 0) {
    return { bytes: null, percent: null, baselineAt: null, truth: 'unavailable' };
  }
  const baseline = candidates[0];
  const bytes = current.usedBytes - baseline.item.usedBytes;
  const percent = baseline.item.usedBytes > 0 ? (bytes / baseline.item.usedBytes) * 100 : null;
  return {
    bytes,
    percent,
    baselineAt: baseline.item.bucket,
    truth: baseline.distance === 0 ? 'observed' : 'estimated',
  };
}

function maintenanceBlockers(plan) {
  if (!plan) {
    return [{
      id: 'maintenance-plan-unavailable',
      class: 'maintenance',
      reason: 'maintenance_plan_unavailable',
      count: null,
      truth: 'unavailable',
    }];
  }
  const blockers = [];
  if (!plan.processComplete) {
    blockers.push({
      id: 'process-observation-incomplete',
      class: 'process_observation',
      reason: 'process_observation_incomplete',
      count: plan.processErrorCount,
      truth: 'observed',
    });
  }
  for (const [className, rawClass] of Object.entries(plan.classes)) {
    const classValue = assertObject(rawClass, `maintenance class ${className}`);
    const candidates = Array.isArray(classValue.candidates) ? classValue.candidates : [];
    const exclusions = Array.isArray(classValue.exclusions) ? classValue.exclusions : [];
    const blockedCandidates = candidates.filter((candidate) => candidate?.automatic_cleanup_authorized !== true);
    if (blockedCandidates.length > 0) {
      blockers.push({
        id: `${className}-authorization`,
        class: className,
        reason: 'cleanup_not_authorized',
        count: blockedCandidates.length,
        truth: 'observed',
      });
    }
    if (exclusions.length > 0) {
      blockers.push({
        id: `${className}-exclusions`,
        class: className,
        reason: 'safety_exclusions_present',
        count: exclusions.length,
        truth: 'observed',
      });
    }
  }
  return blockers.sort((left, right) => left.id.localeCompare(right.id));
}

function violationsFromInventory(inventory) {
  const violations = [];
  if (inventory.filesystem.status !== SAFE_STATUS) {
    violations.push({
      signal: 'filesystem',
      status: inventory.filesystem.status,
      detail: `${inventory.filesystem.usedPercent.toFixed(2)}% used`,
      truth: 'observed',
    });
  }
  if (inventory.temporary.status !== SAFE_STATUS) {
    violations.push({
      signal: 'temporary-storage',
      status: inventory.temporary.status,
      detail: `${inventory.temporary.usedBytes} bytes`,
      truth: 'observed',
    });
  }
  for (const producer of inventory.producers) {
    if (producer.status === SAFE_STATUS) continue;
    violations.push({
      signal: `producer:${producer.id}`,
      status: producer.status,
      detail: `${producer.sizeBytes} / ${producer.hardBytes} bytes`,
      truth: producer.errorCount > 0 ? 'estimated' : 'observed',
    });
  }
  return violations.sort((left, right) => left.signal.localeCompare(right.signal));
}

function currentSignalState(inventory) {
  const state = {
    filesystem: inventory.filesystem.status,
    'temporary-storage': inventory.temporary.status,
  };
  for (const producer of inventory.producers) state[`producer:${producer.id}`] = producer.status;
  return state;
}

function buildNotifications(previousState, currentState, observedAt, existing, maximum) {
  const notifications = [...existing];
  for (const signal of Object.keys(currentState).sort()) {
    const from = typeof previousState[signal] === 'string' ? previousState[signal] : 'unknown';
    const to = currentState[signal];
    if (from === to) continue;
    const crossing = ALERT_STATUSES.has(to);
    const recovery = ALERT_STATUSES.has(from) && to === SAFE_STATUS;
    if (!crossing && !recovery) continue;
    const id = digest({ signal, from, to, observedAt });
    if (notifications.some((item) => item.id === id)) continue;
    notifications.push({
      id,
      signal,
      from,
      to,
      observedAt,
      kind: recovery ? 'recovery' : 'threshold_crossing',
      message: recovery ? `${signal} recovered to ${to}` : `${signal} crossed from ${from} to ${to}`,
    });
  }
  notifications.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
  return notifications.slice(-maximum);
}

function emptyContract(limits) {
  return {
    schemaVersion: CONTRACT_VERSION,
    kind: CONTRACT_KIND,
    generatedAt: null,
    retention: limits,
    source: {},
    current: null,
    hourly: [],
    daily: [],
    notifications: [],
    alertState: {},
    doesNotEstablish: [
      'cleanup_authority',
      'deletion_permission',
      'complete_process_observation',
      'future_storage_growth',
    ],
  };
}

export function collectStorageHealth({ inventory: rawInventory, maintenancePlan: rawPlan = null, existing = null, limits = DEFAULT_LIMITS }) {
  const normalizedLimits = normalizeLimits(limits);
  const inventory = validateInventory(rawInventory);
  const plan = validateMaintenancePlan(rawPlan);
  const previous = existing ? validateExistingContract(existing) : emptyContract(normalizedLimits);
  const observedAt = inventory.generatedAt;
  const hourlyEntry = {
    bucket: hourBucket(observedAt),
    observedAt,
    usedBytes: inventory.filesystem.usedBytes,
    totalBytes: inventory.filesystem.totalBytes,
    usedPercent: inventory.filesystem.usedPercent,
    temporaryBytes: inventory.temporary.usedBytes,
    filesystemStatus: inventory.filesystem.status,
    temporaryStatus: inventory.temporary.status,
    truth: 'observed',
  };
  const hourly = replaceBucket(previous.hourly, 'bucket', hourlyEntry, normalizedLimits.hourlyMax);
  const dailyEntry = {
    date: dayBucket(observedAt),
    observedAt,
    producers: [...inventory.producers]
      .sort((left, right) => right.sizeBytes - left.sizeBytes || left.id.localeCompare(right.id))
      .map((producer) => ({ ...producer, truth: producer.errorCount > 0 ? 'estimated' : 'observed' })),
    unownedArtifacts: inventory.unownedArtifacts,
    truth: inventory.summary.degradedCount > 0 ? 'estimated' : 'observed',
  };
  const daily = replaceBucket(previous.daily, 'date', dailyEntry, normalizedLimits.dailyMax);
  const growth24h = buildGrowth(hourly, hourlyEntry);
  const blockers = maintenanceBlockers(plan);
  const violations = violationsFromInventory(inventory);
  const signals = currentSignalState(inventory);
  const notifications = buildNotifications(
    previous.alertState,
    signals,
    observedAt,
    previous.notifications,
    normalizedLimits.notificationMax,
  );
  const topProducers = dailyEntry.producers.slice(0, 10);
  const contract = {
    schemaVersion: CONTRACT_VERSION,
    kind: CONTRACT_KIND,
    generatedAt: observedAt,
    retention: normalizedLimits,
    source: {
      inventory: {
        generatedAt: inventory.generatedAt,
        sha256: inventory.inventorySha256,
        host: inventory.host,
        truth: 'observed',
      },
      maintenancePlan: plan ? {
        generatedAt: plan.generatedAt,
        planId: plan.planId,
        sha256: plan.planSha256,
        truth: 'observed',
      } : {
        generatedAt: null,
        planId: null,
        sha256: null,
        truth: 'unavailable',
      },
    },
    current: {
      observedAt,
      filesystem: { ...inventory.filesystem, truth: 'observed' },
      temporary: { ...inventory.temporary, truth: 'observed' },
      growth24h,
      topProducers,
      budgetViolations: violations,
      unownedArtifacts: inventory.unownedArtifacts,
      cleanupBlockers: blockers,
      summary: {
        producerCount: inventory.producers.length,
        budgetViolationCount: violations.length,
        cleanupBlockerCount: blockers.length,
        unownedArtifactCount: inventory.unownedArtifacts.length,
        notificationCount: notifications.length,
      },
    },
    hourly,
    daily,
    notifications,
    alertState: signals,
    doesNotEstablish: [...new Set([
      ...inventory.doesNotEstablish,
      'cleanup_authority',
      'deletion_permission',
      'future_storage_growth',
    ])].sort(),
  };
  validateExistingContract(contract);
  return contract;
}

async function readJson(path, { optional = false } = {}) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (optional && error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw new Error(`cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function atomicWriteJson(path, payload) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
    const directory = await open(dirname(target), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseArgs(argv) {
  const options = {
    inventory: process.env.LEITSTAND_STORAGE_INVENTORY_PATH ?? null,
    maintenancePlan: process.env.LEITSTAND_CACHE_MAINTENANCE_PLAN_PATH ?? null,
    output: process.env.LEITSTAND_STORAGE_HEALTH_PATH ?? resolve(process.cwd(), 'artifacts', 'storage-health.json'),
    hourlyMax: DEFAULT_LIMITS.hourlyMax,
    dailyMax: DEFAULT_LIMITS.dailyMax,
    notificationMax: DEFAULT_LIMITS.notificationMax,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--inventory') options.inventory = value, index += 1;
    else if (argument === '--maintenance-plan') options.maintenancePlan = value, index += 1;
    else if (argument === '--output') options.output = value, index += 1;
    else if (argument === '--hourly-max') options.hourlyMax = Number(value), index += 1;
    else if (argument === '--daily-max') options.dailyMax = Number(value), index += 1;
    else if (argument === '--notification-max') options.notificationMax = Number(value), index += 1;
    else throw new Error(`unknown or incomplete argument: ${argument}`);
  }
  if (!options.inventory) throw new Error('--inventory or LEITSTAND_STORAGE_INVENTORY_PATH is required');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const inventoryPath = resolve(options.inventory);
  const maintenancePath = options.maintenancePlan ? resolve(options.maintenancePlan) : null;
  const outputPath = resolve(options.output);
  const [inventory, maintenancePlan, existing] = await Promise.all([
    readJson(inventoryPath),
    maintenancePath ? readJson(maintenancePath) : Promise.resolve(null),
    readJson(outputPath, { optional: true }),
  ]);
  const payload = collectStorageHealth({
    inventory,
    maintenancePlan,
    existing,
    limits: {
      hourlyMax: options.hourlyMax,
      dailyMax: options.dailyMax,
      notificationMax: options.notificationMax,
    },
  });
  await atomicWriteJson(outputPath, payload);
  process.stdout.write(`${JSON.stringify({
    status: 'written',
    output: outputPath,
    outputName: basename(outputPath),
    generatedAt: payload.generatedAt,
    hourlyCount: payload.hourly.length,
    dailyCount: payload.daily.length,
    notificationCount: payload.notifications.length,
    contractSha256: digest(payload),
  })}\n`);
  return 0;
}

const directRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
