import { describe, it, expect } from 'vitest';
import { parseTargetDate } from '../src/cli.js';

describe('cli date parsing', () => {
  it('returns current date when input is omitted', () => {
    const now = new Date();
    const parsed = parseTargetDate();

    expect(parsed.getFullYear()).toBe(now.getFullYear());
  });

  it('parses valid ISO dates', () => {
    const parsed = parseTargetDate('2025-12-05');

    expect(parsed.getFullYear()).toBe(2025);
    expect(parsed.getMonth()).toBe(11); // December (0-indexed)
    expect(parsed.getDate()).toBe(5);
  });

  it('throws for invalid date strings', () => {
    expect(() => parseTargetDate('invalid-date')).toThrow(
      'Invalid date format. Please use YYYY-MM-DD.'
    );
  });
});
