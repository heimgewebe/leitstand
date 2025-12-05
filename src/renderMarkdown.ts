import type { DailyDigest } from './digest.js';
import { format, parseISO } from 'date-fns';

/**
 * Renders a daily digest to Markdown format
 * 
 * @param digest - The daily digest to render
 * @returns Markdown string
 */
export function renderDailyDigestMarkdown(digest: DailyDigest): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`# Heimgewebe Digest – ${digest.date}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  
  // Top topics section
  lines.push('## Top Topics');
  lines.push('');
  
  if (digest.topics.length > 0) {
    for (const { topic, count } of digest.topics) {
      lines.push(`- **${topic}** (${count})`);
    }
  } else {
    lines.push('_No topics available_');
  }
  lines.push('');
  
  // Questions section (if any)
  if (digest.questions.length > 0) {
    lines.push('### Questions');
    lines.push('');
    for (const question of digest.questions) {
      lines.push(`- ${question}`);
    }
    lines.push('');
  }
  
  // Deltas section (if any)
  if (digest.deltas.length > 0) {
    lines.push('### Changes Detected');
    lines.push('');
    for (const delta of digest.deltas) {
      lines.push(`- ${delta}`);
    }
    lines.push('');
  }
  
  // Key events section
  lines.push('## Key Events (last 24h)');
  lines.push('');
  
  if (digest.events.length > 0) {
    for (const event of digest.events) {
      const timestamp = format(parseISO(event.timestamp), 'HH:mm:ss');
      lines.push(`- \`${timestamp}\` ${event.label}`);
    }
  } else {
    lines.push('_No events recorded_');
  }
  lines.push('');
  
  // Fleet health section
  lines.push('## Fleet Health');
  lines.push('');
  
  if (digest.fleetHealth.available) {
    const { totalRepos, ok, warn, fail, timestamp } = digest.fleetHealth;
    const lastUpdate = timestamp ? format(parseISO(timestamp), 'yyyy-MM-dd HH:mm:ss') : 'unknown';
    
    lines.push(`**Total Repositories:** ${totalRepos}`);
    lines.push('');
    lines.push('**Status Breakdown:**');
    lines.push(`- ✅ OK: ${ok}`);
    lines.push(`- ⚠️  Warning: ${warn}`);
    lines.push(`- ❌ Failed: ${fail}`);
    lines.push('');
    lines.push(`_Last updated: ${lastUpdate}_`);
  } else {
    lines.push('_No metrics available_');
  }
  lines.push('');
  
  return lines.join('\n');
}
