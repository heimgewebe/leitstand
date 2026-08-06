/**
 * Shared freshness policy for fast-moving operator snapshots.
 *
 * The producer timer runs every ten minutes. A snapshot becomes stale after
 * two missed producer runs so the rendered boards and `/health` cannot disagree
 * about whether the same operational evidence is current.
 */
export const OPERATIONAL_SNAPSHOT_STALE_AFTER_MINUTES = 20;
export const OPERATIONAL_SNAPSHOT_STALE_AFTER_MS =
  OPERATIONAL_SNAPSHOT_STALE_AFTER_MINUTES * 60 * 1000;
