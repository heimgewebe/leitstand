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
      expect(content).not.toContain('card.innerHTML = `');
      expect(content).toContain('.textContent = routine.');
      expect(content).toContain('acsLink.rel = \'noopener noreferrer\'');
    }

    if (filePath.includes('observatory')) {
      // Should not concatenate Error string into innerHTML
      expect(content).not.toMatch(/statusEl\.innerHTML\s*=\s*".*String\(e\)/);
      // Should use textContent for clearing or setting static text
      expect(content).toContain('statusEl.textContent = ""');
      // Should use textContent on strong element for the failure message
      expect(content).toContain('.textContent = "Runtime fetch failed."');
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
