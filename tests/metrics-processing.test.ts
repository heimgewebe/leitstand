import { describe, it, expect } from 'vitest';
import { processRepoStatus, type RepoData } from '../src/metrics.js';

describe('processRepoStatus', () => {
  it('should remove "missing .wgx/profile.yml" when profile_expected is false in ai_context', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail',
      ai_context: {
        heimgewebe: {
          wgx: {
            profile_expected: false
          }
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).not.toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('ok');
  });

  it('should remove "missing .wgx/profile.yml" when profile_expected is false in config', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail',
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).not.toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('ok');
  });

  it('should preserve other issues when "missing .wgx/profile.yml" is removed', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml', 'another issue'],
      status: 'fail',
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toEqual(['another issue']);
    expect(processed.status).toBe('fail'); // Status stays fail because of 'another issue'
  });

  it('should not remove "missing .wgx/profile.yml" when profile_expected is true', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail',
      config: {
        wgx: {
          profile_expected: true
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('fail');
  });

  it('should default profile_expected to true if not specified', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail'
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('fail');
  });

  it('should not modify anything if "missing .wgx/profile.yml" is not present', () => {
    const repo: RepoData = {
      issues: ['another issue'],
      status: 'fail',
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toEqual(['another issue']);
    expect(processed.status).toBe('fail');
  });

  it('should handle repository with no issues', () => {
    const repo: RepoData = {
      issues: [],
      status: 'ok',
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toEqual([]);
    expect(processed.status).toBe('ok');
  });

  it('should handle repository with undefined issues', () => {
    const repo: RepoData = {
      status: 'ok',
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    expect(processed.issues).toBeUndefined();
    expect(processed.status).toBe('ok');
  });

  it('should prefer ai_context over config for profile_expected (precedence check: true wins over false)', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail',
      ai_context: {
        heimgewebe: {
          wgx: {
            profile_expected: true
          }
        }
      },
      config: {
        wgx: {
          profile_expected: false
        }
      }
    };

    const processed = processRepoStatus(repo);

    // ai_context (true) should win, so issue remains
    expect(processed.issues).toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('fail');
  });

  it('should prefer ai_context over config for profile_expected (precedence check: false wins over true)', () => {
    const repo: RepoData = {
      issues: ['missing .wgx/profile.yml'],
      status: 'fail',
      ai_context: {
        heimgewebe: {
          wgx: {
            profile_expected: false
          }
        }
      },
      config: {
        wgx: {
          profile_expected: true
        }
      }
    };

    const processed = processRepoStatus(repo);

    // ai_context (false) should win, so issue is removed
    expect(processed.issues).not.toContain('missing .wgx/profile.yml');
    expect(processed.status).toBe('ok');
  });
});
