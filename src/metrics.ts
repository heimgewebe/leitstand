import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Repository status from metrics
 */
export interface RepoStatus {
  ok: number;
  warn: number;
  fail: number;
}

/**
 * Minimal metrics snapshot structure (subset of metrics.snapshot.schema.json from metarepo)
 */
export interface MetricsSnapshot {
  /** Timestamp of the snapshot */
  timestamp: string;
  /** Total number of repositories */
  repoCount: number;
  /** Repository status breakdown */
  status: RepoStatus;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Loads a metrics snapshot from a specific file path
 * 
 * @param filePath - Path to the metrics JSON file
 * @returns Parsed metrics snapshot
 * @throws Error if file cannot be read or parsed
 */
export async function loadMetricsSnapshot(filePath: string): Promise<MetricsSnapshot> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Extract basic metrics with fallback defaults
    const repoCount = data.repoCount || data.repos?.length || 0;
    const status = data.status || {
      ok: data.ok || 0,
      warn: data.warn || 0,
      fail: data.fail || 0,
    };
    
    return {
      timestamp: data.timestamp || new Date().toISOString(),
      repoCount,
      status,
      metadata: data.metadata,
    };
  } catch (error) {
    throw new Error(`Failed to load metrics snapshot from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Loads the latest metrics snapshot from the metrics directory
 *
 * @param metricsDir - Directory containing metrics snapshot JSON files
 * @returns Latest metrics snapshot, or null if none found
 */
export async function loadLatestMetrics(metricsDir: string): Promise<MetricsSnapshot | null> {
  try {
    const files = await readdir(metricsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      return null;
    }

    // Always pick the most recently modified metrics file to avoid serving stale data,
    // regardless of whether it's named using a date or a "latest.json" alias.
    const stats = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = join(metricsDir, file);
        const fileStat = await stat(filePath);
        return { file, filePath, mtime: fileStat.mtime };
      })
    );

    const latest = stats.reduce((currentLatest, entry) => {
      if (!currentLatest) return entry;

      if (entry.mtime > currentLatest.mtime) {
        return entry;
      }

      // Stable tie-breaker: prefer date-named snapshots, otherwise use lexicographic order
      if (entry.mtime.getTime() === currentLatest.mtime.getTime()) {
        const entryIsDated = /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.file);
        const latestIsDated = /^\d{4}-\d{2}-\d{2}\.json$/.test(currentLatest.file);
        if (entryIsDated !== latestIsDated) {
          return entryIsDated ? entry : currentLatest;
        }
        return entry.file > currentLatest.file ? entry : currentLatest;
      }

      return currentLatest;
    }, null as { file: string; filePath: string; mtime: Date } | null);

    return latest ? await loadMetricsSnapshot(latest.filePath) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory doesn't exist or is empty
      return null;
    }
    throw new Error(`Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
  }
}
