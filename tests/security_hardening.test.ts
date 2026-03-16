import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Security Hardening - Client-side XSS Prevention', () => {
  it('src/views/ops.ejs should not use innerHTML for routine rendering', () => {
    const filePath = path.join(process.cwd(), 'src/views/ops.ejs');
    const content = fs.readFileSync(filePath, 'utf-8');

    // We want to ensure that inside the routine loop, innerHTML is not used to build the card
    // The previous vulnerable code was card.innerHTML = `...`
    // We expect the use of createElement/textContent instead.

    // Check that we are using textContent for dynamic routine data
    expect(content).toContain('idSpan.textContent = routine.id');
    expect(content).toContain('riskSpan.textContent = `Risk: ${routine.risk}`');
    expect(content).toContain('reasonP.textContent = routine.reason');

    // Ensure the old vulnerable pattern is gone
    expect(content).not.toContain('card.innerHTML = `');
  });

  it('src/views/observatory.ejs should not use innerHTML for error/status rendering', () => {
    const filePath = path.join(process.cwd(), 'src/views/observatory.ejs');
    const content = fs.readFileSync(filePath, 'utf-8');

    // Vulnerable code: statusEl.innerHTML = "<strong>Runtime fetch failed.</strong><br>" + String(e);
    // Fixed code uses textContent and appendChild

    expect(content).toContain('statusEl.textContent = ""');
    expect(content).toContain('strong.textContent = "Runtime fetch failed."');
    expect(content).not.toMatch(/statusEl\.innerHTML\s*=\s*".*String\(e\)/);
  });

  it('src/views/ops.ejs should have rel="noopener noreferrer" for external links', () => {
    const filePath = path.join(process.cwd(), 'src/views/ops.ejs');
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('acsLink.rel = \'noopener noreferrer\'');
  });
});
