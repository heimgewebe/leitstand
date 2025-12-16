#!/usr/bin/env node

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format, startOfDay, addDays, parseISO, isValid } from 'date-fns';
import { loadConfig } from './config.js';
import { loadDailyInsights } from './insights.js';
import { loadRecentEvents } from './events.js';
import { loadLatestMetrics, loadMetricsSnapshot } from './metrics.js';
import { buildDailyDigest } from './digest.js';
import { renderDailyDigestMarkdown } from './renderMarkdown.js';

/**
 * Parses command line arguments
 */
function parseArgs(): { configPath?: string; date?: string; help: boolean } {
  const args = process.argv.slice(2);
  const result: { configPath?: string; date?: string; help: boolean } = { help: false };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--config' && i + 1 < args.length) {
      result.configPath = args[++i];
    } else if (arg === '--date' && i + 1 < args.length) {
      result.date = args[++i];
    }
  }
  
  return result;
}

/**
 * Parses and validates the target date for the digest.
 *
 * @param dateInput - Optional date string (YYYY-MM-DD)
 * @returns Date object for the requested day
 * @throws Error when the provided date is invalid
 */
export function parseTargetDate(dateInput?: string): Date {
  const parsed = dateInput ? parseISO(dateInput) : new Date();

  if (!isValid(parsed)) {
    throw new Error('Invalid date format. Please use YYYY-MM-DD.');
  }

  return parsed;
}

/**
 * Prints usage information
 */
function printUsage(): void {
  console.log(`
Usage: leitstand [options]

Options:
  --config <path>   Path to configuration file (default: leitstand.config.json)
  --date YYYY-MM-DD Date for the digest (default: today)
  --help, -h        Show this help message

Examples:
  leitstand --config leitstand.config.json
  leitstand --date 2025-12-04
`);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = parseArgs();
  
  if (args.help) {
    printUsage();
    process.exit(0);
  }
  
  const configPath = args.configPath || 'leitstand.config.json';
  
  try {
    // Load configuration
    console.log(`Loading configuration from ${configPath}...`);
    const config = await loadConfig(configPath);
    
    // Determine the date for the digest
    const targetDate = parseTargetDate(args.date);
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    console.log(`Generating digest for ${dateStr}...`);
    
    // Calculate time window (24 hours for the target date)
    const since = startOfDay(targetDate);
    const until = addDays(since, 1);
    
    // Load data from all sources
    console.log('Loading daily insights...');
    let insights = null;
    try {
      // Determine which insights file to load
      // If today, use todayInsights from config
      // If historical date, try to find it in daily directory
      // We assume daily directory is parent of todayInsights + /daily/
      const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
      let insightsPath = config.paths.semantah.todayInsights;

      if (!isToday) {
        // Try to construct historical path
        // Standard layout: .../insights/today.json -> .../insights/daily/YYYY-MM-DD.json
        const insightsDir = join(dirname(config.paths.semantah.todayInsights), 'daily');
        insightsPath = join(insightsDir, `${dateStr}.json`);
        console.log(`  Targeting historical insights: ${insightsPath}`);
      }

      insights = await loadDailyInsights(insightsPath);
    } catch (error) {
      console.warn(`Warning: Could not load insights: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    console.log('Loading recent events...');
    let events: Awaited<ReturnType<typeof loadRecentEvents>> = [];
    try {
      events = await loadRecentEvents(config.paths.chronik.dataDir, since, until);
      console.log(`  Found ${events.length} events`);
    } catch (error) {
      console.warn(`Warning: Could not load events: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    console.log('Loading fleet metrics...');
    let metrics = null;
    try {
      // Let's try to manually construct the path if we are looking for history.
      const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

      if (!isToday) {
         // Try to load specific metrics file
         const metricsPath = join(config.paths.wgx.metricsDir, `${dateStr}.json`);
         try {
             metrics = await loadMetricsSnapshot(metricsPath);
             console.log(`  Loaded historical metrics from ${metricsPath}`);
         } catch (e) {
             console.log(`  Could not load historical metrics for ${dateStr}, falling back to latest.`);
             metrics = await loadLatestMetrics(config.paths.wgx.metricsDir);
         }
      } else {
         metrics = await loadLatestMetrics(config.paths.wgx.metricsDir);
      }

      if (metrics) {
        console.log(`  Metrics from ${metrics.timestamp}`);
      } else {
        console.log('  No metrics available');
      }
    } catch (error) {
      console.warn(`Warning: Could not load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Build the digest
    console.log('Building digest...');
    const digest = buildDailyDigest(
      dateStr,
      insights,
      events,
      metrics,
      config.digest?.maxEvents || 20
    );
    
    // Ensure output directory exists
    const outputDir = config.output.dir;
    await mkdir(outputDir, { recursive: true });
    
    // Write markdown file
    const markdownPath = join(outputDir, `${dateStr}.md`);
    const markdown = renderDailyDigestMarkdown(digest);
    await writeFile(markdownPath, markdown, 'utf-8');
    console.log(`✓ Written: ${markdownPath}`);
    
    // Write JSON file
    const jsonPath = join(outputDir, `${dateStr}.json`);
    await writeFile(jsonPath, JSON.stringify(digest, null, 2), 'utf-8');
    console.log(`✓ Written: ${jsonPath}`);
    
    // Print summary
    console.log('\nDigest Summary:');
    console.log(`  Date: ${dateStr}`);
    console.log(`  Topics: ${digest.topics.length}`);
    console.log(`  Events: ${digest.events.length}`);
    console.log(`  Fleet health: ${digest.fleetHealth.available ? 'available' : 'unavailable'}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
