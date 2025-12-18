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
  /**
   * Optional: Repos array if present in the source file.
   * Although not strictly part of the minimal interface, it is preserved if present
   * to allow consistent UI rendering after patching.
   */
  repos?: RepoData[];
}

interface RepoData {
  name?: string;
  issues?: string[];
  status?: string;
  ai_context?: {
    heimgewebe?: {
      wgx?: {
        profile_expected?: boolean;
      };
    };
  };
  // Supporting flattened config if that's how it's structured
  config?: {
    wgx?: {
      profile_expected?: boolean;
    };
  };
  [key: string]: unknown;
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

    // We will recalculate status if repos array is present
    let status = data.status || {
      ok: data.ok || 0,
      warn: data.warn || 0,
      fail: data.fail || 0,
    };

    let processedRepos: RepoData[] | undefined = undefined;
    let unknownCount = 0;

    // If we have access to individual repos AND they are objects (not just strings),
    // we can patch the status counts.
    if (Array.isArray(data.repos) && data.repos.length > 0 && typeof data.repos[0] === 'object') {
      let ok = 0;
      let warn = 0;
      let fail = 0;

      // Map to new array to avoid mutating original data
      processedRepos = (data.repos as RepoData[]).map(repo => {
        // Shallow clone the repo object
        const newRepo = { ...repo };
        let issues = [...(repo.issues || [])];
        let repoStatus = repo.status || 'unknown';

        // Determine if profile is expected (default to true if not specified)
        // Check both ai_context path and potential config path
        const profileExpected =
          repo.ai_context?.heimgewebe?.wgx?.profile_expected ??
          repo.config?.wgx?.profile_expected ??
          true;

        if (issues.includes('missing .wgx/profile.yml') && !profileExpected) {
           // If the issue is present but profile is not expected, we remove the issue
           issues = issues.filter(i => i !== 'missing .wgx/profile.yml');
           newRepo.issues = issues;

           // Re-evaluate status
           if (issues.length === 0) {
             // If no issues remain, it's definitely OK
             repoStatus = 'ok';
             newRepo.status = 'ok';
           } else {
             // If issues remain, we preserve the original status because we don't know
             // the severity of the remaining issues.
             // (e.g. if it was 'fail', it stays 'fail'; if 'warn', stays 'warn')
           }
        }

        if (repoStatus === 'ok') ok++;
        else if (repoStatus === 'warn') warn++;
        else if (repoStatus === 'fail') fail++;
        else unknownCount++;

        return newRepo;
      });

      // Only override if we actually counted something (sanity check)
      if (ok + warn + fail + unknownCount > 0) {
        status = { ok, warn, fail };
      }
    }

    const metadata = data.metadata || {};
    if (unknownCount > 0) {
      metadata.unknown_count = unknownCount;
    }

    // If processedRepos is undefined, it means we didn't process them (maybe strings or empty),
    // so we return the original data.repos (which might be strings).
    // Note: MetricsSnapshot interface says repos?: RepoData[], but if source has strings,
    // it technically violates the interface if we strictly checked, but here we just pass it through.
    // Ideally we should filter or not return it if it doesn't match, but to stay compatible:

    return {
      timestamp: data.timestamp || new Date().toISOString(),
      repoCount,
      status,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      repos: processedRepos || data.repos,
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
