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
    
    // Find the most recent file by modification time
    let latestFile = jsonFiles[0];
    let latestMtime = (await stat(join(metricsDir, latestFile))).mtime;
    
    for (const file of jsonFiles.slice(1)) {
      const filePath = join(metricsDir, file);
      const fileStat = await stat(filePath);
      if (fileStat.mtime > latestMtime) {
        latestFile = file;
        latestMtime = fileStat.mtime;
      }
    }
    
    // Load and parse the latest file
    const content = await readFile(join(metricsDir, latestFile), 'utf-8');
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory doesn't exist or is empty
      return null;
    }
    throw new Error(`Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
  }
}
