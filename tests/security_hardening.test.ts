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
      expect(content).toContain('.textContent = routine.id');
      expect(content).toContain('.textContent = routine.reason');

      // Ensure security attribute is set for dynamically created links in JS
      expect(content).toMatch(/\.rel\s*=\s*['"]noopener noreferrer['"]/);
    }

    if (filePath.includes('observatory')) {
      // Should not concatenate Error string into innerHTML
      expect(content).not.toMatch(/statusEl\.innerHTML\s*=\s*".*String\(e\)/);

      // Should use safe node construction for the error message
      expect(content).toContain('strong.textContent = "Runtime fetch failed."');
      expect(content).toContain('document.createTextNode(String(e))');

      // Should use textContent for clearing
      expect(content).toContain('statusEl.textContent = ""');
    }

    // Verify all static HTML links with target="_blank" have rel="noopener noreferrer"
    // Use a regex that looks for the presence of target="_blank" and rel="noopener noreferrer" in the same tag
    const linkTags = content.match(/<a[^>]+target=["']_blank["'][^>]*>/g) || [];
    linkTags.forEach(tag => {
      expect(tag, `Link tag missing rel="noopener noreferrer": ${tag}`).toContain('rel="noopener noreferrer"');
    });
  };

  it('src/views/ops.ejs should use safe DOM APIs and have hardened links', () => {
    checkXSSPrevention(path.join(process.cwd(), 'src/views/ops.ejs'));
  });

  it('src/views/observatory.ejs should use safe DOM APIs for error rendering and have hardened links', () => {
    checkXSSPrevention(path.join(process.cwd(), 'src/views/observatory.ejs'));
  });

  it('observatory_debug.html should use safe DOM APIs for error rendering and have hardened links', () => {
    checkXSSPrevention(path.join(process.cwd(), 'observatory_debug.html'));
  });
});
