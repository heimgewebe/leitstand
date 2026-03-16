import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Security Hardening - Client-side XSS Prevention', () => {
  const checkXSSPrevention = (filePath: string) => {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Ensure dangerous innerHTML pattern with dynamic data is removed
    // We specifically look for the patterns we fixed:
    // 1. routine card rendering in ops.ejs
    // 2. error status rendering in observatory.ejs / observatory_debug.html

    if (filePath.endsWith('ops.ejs')) {
      // Ensure dangerous innerHTML usage with routine data is removed
      expect(content).not.toMatch(/card\.innerHTML\s*=\s*`/);
      // Ensure safe textContent is used for dynamic data
      expect(content).toMatch(/\.textContent\s*=\s*routine\./);
      // Ensure security attribute is set for dynamically created links
      expect(content).toMatch(/\.rel\s*=\s*['"]noopener noreferrer['"]/);
    }

    if (filePath.includes('observatory')) {
      // Should not concatenate Error string into innerHTML
      expect(content).not.toMatch(/statusEl\.innerHTML\s*=\s*".*String\(e\)/);
      // Should use safe textContent or individual node construction
      expect(content).toMatch(/\.textContent\s*=\s*""/);
      expect(content).toMatch(/\.textContent\s*=\s*['"]Runtime fetch failed\.['"]/);
    }

    // Global check for all target="_blank" links
    if (content.includes('target="_blank"')) {
      expect(content).toContain('rel="noopener noreferrer"');
    }
  };

  it('src/views/ops.ejs should use safe DOM APIs and have hardened links', () => {
    checkXSSPrevention(path.join(process.cwd(), 'src/views/ops.ejs'));
  });

  it('src/views/observatory.ejs should use safe DOM APIs for error rendering', () => {
    checkXSSPrevention(path.join(process.cwd(), 'src/views/observatory.ejs'));
  });

  it('observatory_debug.html should use safe DOM APIs for error rendering', () => {
    checkXSSPrevention(path.join(process.cwd(), 'observatory_debug.html'));
  });
});
