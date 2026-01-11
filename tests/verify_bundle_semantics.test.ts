
import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface SelfModel {
  confidence: number;
  fatigue: number;
  risk_tension: number;
  autonomy_level: "dormant" | "aware" | "reflective" | "critical";
  last_updated?: string;
  basis_signals: string[];
}

interface SelfStateSnapshot {
  timestamp: string;
  state: SelfModel;
}

interface SelfStateArtifact {
  schema?: string;
  current: SelfModel;
  history: SelfStateSnapshot[];
}

describe('SelfState Bundle Semantics (Consumer Hardening)', () => {
  const fixturePath = join(process.cwd(), 'src', 'fixtures', 'self_state.json');

  it('Test 1: should be parseable and have expected keys and schema', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const data: SelfStateArtifact = JSON.parse(content);

    expect(data.schema).toBe("heimgeist.self_state.bundle.v1");
    expect(data.current).toBeDefined();
    expect(data.history).toBeDefined();
    expect(Array.isArray(data.history)).toBe(true);
  });

  it('Test 2: should have history snapshots with timestamp and state', async () => {
    const content = await readFile(fixturePath, 'utf-8');
    const data: SelfStateArtifact = JSON.parse(content);

    if (data.history.length > 0) {
        const snap = data.history[0];
        expect(snap.timestamp).toBeDefined();
        expect(snap.state).toBeDefined();
        // Ensure state metrics are present
        expect(typeof snap.state.confidence).toBe('number');
    }
  });

  it('Test 3: should handle normalization of history (descending sort by timestamp)', async () => {
      // Simulate the logic in src/server.ts
      const content = await readFile(fixturePath, 'utf-8');
      const data: SelfStateArtifact = JSON.parse(content);

      // Add unsorted items
      data.history.push({
          timestamp: "2020-01-01T00:00:00Z",
          state: { confidence: 0.1, fatigue: 0.1, risk_tension: 0.1, autonomy_level: 'dormant', basis_signals: [] }
      });
       data.history.push({
          timestamp: "2025-01-01T00:00:00Z",
          state: { confidence: 0.1, fatigue: 0.1, risk_tension: 0.1, autonomy_level: 'dormant', basis_signals: [] }
      });

      // Apply Sort logic (mirroring server.ts)
      data.history.sort((a, b) => {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
       });

       // Expect 2025 first
       expect(data.history[0].timestamp).toBe("2025-01-01T00:00:00Z");
       // Expect 2020 last
       expect(data.history[data.history.length - 1].timestamp).toBe("2020-01-01T00:00:00Z");
  });
});
