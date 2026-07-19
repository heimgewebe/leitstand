import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const viewsDir = join(process.cwd(), 'src', 'views');
const views = readdirSync(viewsDir).filter(f => f.endsWith('.ejs'));

describe('View Security & Boundaries', () => {
  it.each(views)('%s contains no unsafe target=_blank links', (file) => {
    const content = readFileSync(join(viewsDir, file), 'utf-8');
    const links = [...content.matchAll(/<a[^>]+target=["']_blank["'][^>]*>/gi)];
    for (const match of links) {
      expect(match[0]).toMatch(/rel=["'](?:noopener noreferrer|noreferrer noopener)["']/);
    }
  });

  it.each(views)('%s contains no unescaped output except for safe includes', (file) => {
    const content = readFileSync(join(viewsDir, file), 'utf-8');
    const unescaped = [...content.matchAll(/<%-([^>]+)%>/g)];
    for (const match of unescaped) {
      const code = match[1].trim();
      // Allow include(), conditional aria-current, and JSON blobs for scripts
      expect(code.startsWith('include(') || code.includes('aria-current') || code.includes('_json')).toBe(true);
    }
  });

  it.each(views)('%s does not assert unauthorized role boundaries', (file) => {
    const content = readFileSync(join(viewsDir, file), 'utf-8');
    // We check that Leitstand doesn't claim to manage tasks or orchestration
    expect(content).not.toMatch(/Leitstand .* Tasks/i);
    // Disallow un-prefixed phase claims
    const visiblePhaseClaims = [...content.matchAll(/class="[^"]*"[^>]*>[^<]*\bPhasen?\b/gi)];
    expect(visiblePhaseClaims.length).toBe(0);
    const visibleOrganismusClaims = [...content.matchAll(/class="[^"]*"[^>]*>[^<]*\bOrganismus\b/gi)];
    expect(visibleOrganismusClaims.length).toBe(0);
  });
});
