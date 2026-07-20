import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PilotArtifact {
  kind: string;
  path: string;
  sha256: string;
  bytes?: number;
  generatedAt?: string;
  sourceRepository?: string;
  sourceCommit?: string;
  comparedWithCommit?: string;
  status?: string;
  reason?: string;
}

interface PilotSource {
  id: string;
  authority: string;
  evidenceMode: string;
  observedState: string;
  artifact: PilotArtifact;
  doesNotEstablish: string[];
}

interface PilotScenario {
  id: string;
  state: string;
  evidenceMode: string;
  sourceIds: string[];
  liveIncidentObserved: boolean;
  artifact?: PilotArtifact;
  verifier: {
    testFile: string;
    assertion: string;
  };
}

interface PilotEvidence {
  schemaVersion: number;
  kind: string;
  taskId: string;
  observedLeitstand: {
    commit: string;
    service: {
      unit: string;
      activeState: string;
      subState: string;
      restartCount: number;
    };
  };
  sourceContract: {
    mode: string;
    contentCopied: boolean;
  };
  sources: PilotSource[];
  scenarios: PilotScenario[];
  validation: {
    focusedVitest: {
      tests: number;
      status: string;
      receiptSha256: string;
    };
    browserShell: {
      mobile: string;
      desktop: string;
      receiptSha256: string;
    };
  };
  boundary: {
    viewOnly: boolean;
    mutationsAllowed: boolean;
    writeCapabilities: string[];
    forbiddenActions: string[];
  };
  doesNotEstablish: string[];
}

const REPORT_PATH = join(
  process.cwd(),
  'docs',
  'reports',
  'visualization-pilot-2026-07-20.json',
);
const MARKDOWN_PATH = join(
  process.cwd(),
  'docs',
  'reports',
  'visualization-pilot-2026-07-20.md',
);

async function readEvidence(): Promise<PilotEvidence> {
  return JSON.parse(await readFile(REPORT_PATH, 'utf-8')) as PilotEvidence;
}

describe('LSV-V1-T007 visualization pilot evidence', () => {
  it('binds the pilot to the exact production Leitstand commit and receipts', async () => {
    const evidence = await readEvidence();

    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.kind).toBe('leitstand_visualization_pilot_evidence');
    expect(evidence.taskId).toBe('LSV-V1-T007');
    expect(evidence.observedLeitstand.commit).toBe(
      '4218e10ab4ea9dc029c98009f4f142c7bbcc81eb',
    );
    expect(evidence.observedLeitstand.service).toEqual({
      unit: 'leitstand.service',
      activeState: 'active',
      subState: 'running',
      restartCount: 0,
    });
    expect(evidence.validation.focusedVitest).toMatchObject({
      tests: 37,
      status: 'pass',
    });
    expect(evidence.validation.focusedVitest.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.validation.browserShell.mobile).toContain('21/21');
    expect(evidence.validation.browserShell.desktop).toContain('13/13');
    expect(evidence.validation.browserShell.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records all required real source identities without copying source contents', async () => {
    const evidence = await readEvidence();
    const sourceIds = evidence.sources.map((source) => source.id).sort();

    expect(sourceIds).toEqual([
      'chronik',
      'repoground',
      'semantah',
      'systemkatalog',
      'wgx',
    ]);
    expect(evidence.sourceContract).toEqual({
      mode: 'identity_only',
      contentCopied: false,
      description: expect.any(String),
    });

    for (const source of evidence.sources) {
      expect(source.evidenceMode).toBe('live_artifact');
      expect(source.observedState).toBe('valid');
      expect(source.artifact.path).toMatch(/^\//);
      expect(source.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.artifact.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.artifact.sourceRepository).toMatch(/^heimgewebe\//);
      expect(source.doesNotEstablish.length).toBeGreaterThan(0);
    }
  });

  it('covers valid, missing, corrupt, stale and export-safety-fail states', async () => {
    const evidence = await readEvidence();
    const states = new Set(evidence.scenarios.map((scenario) => scenario.state));

    for (const state of ['valid', 'missing', 'corrupt', 'stale', 'export-safety-fail']) {
      expect(states.has(state)).toBe(true);
    }

    for (const scenario of evidence.scenarios) {
      expect(scenario.sourceIds.length).toBeGreaterThan(0);
      expect(scenario.verifier.testFile).toMatch(/^tests\//);
      expect(scenario.verifier.assertion.length).toBeGreaterThan(20);
    }
  });

  it('does not disguise synthetic missing or corrupt cases as live incidents', async () => {
    const evidence = await readEvidence();
    const injected = evidence.scenarios.filter(
      (scenario) => scenario.state === 'missing' || scenario.state === 'corrupt',
    );

    expect(injected.length).toBeGreaterThanOrEqual(3);
    for (const scenario of injected) {
      expect(scenario.evidenceMode).toBe('synthetic_fault_injection');
      expect(scenario.liveIncidentObserved).toBe(false);
    }
  });

  it('keeps the real export-safety failure visible and digest-bound', async () => {
    const evidence = await readEvidence();
    const scenario = evidence.scenarios.find(
      (candidate) => candidate.state === 'export-safety-fail',
    );

    expect(scenario).toBeDefined();
    expect(scenario?.evidenceMode).toBe('live_artifact');
    expect(scenario?.liveIncidentObserved).toBe(true);
    expect(scenario?.artifact).toMatchObject({
      kind: 'lenskit.export_safety_report',
      sha256: 'b0cf4ffb2ee6bbbb7277cb5fe70dd48080d212a033d5c156a42dc1e03290af39',
      status: 'fail',
      reason: 'agent_export_gate_required_but_missing_or_not_pass',
    });
  });

  it('preserves the read-only truth boundary', async () => {
    const evidence = await readEvidence();

    expect(evidence.boundary.viewOnly).toBe(true);
    expect(evidence.boundary.mutationsAllowed).toBe(false);
    expect(evidence.boundary.writeCapabilities).toEqual([]);
    expect(evidence.boundary.forbiddenActions).toEqual(expect.arrayContaining([
      'task_dispatch',
      'source_repair',
      'repository_mutation',
      'merge',
      'deployment',
      'external_refresh',
    ]));
    expect(evidence.doesNotEstablish).toEqual(expect.arrayContaining([
      'source_truth',
      'runtime_correctness',
      'comprehensive_source_coverage',
      'public_export_safety',
    ]));
  });

  it('keeps the human-readable report bound to the machine evidence', async () => {
    const markdown = await readFile(MARKDOWN_PATH, 'utf-8');

    expect(markdown).toContain('LSV-V1-T007');
    expect(markdown).toContain('visualization-pilot-2026-07-20.json');
    expect(markdown).toContain('4218e10ab4ea9dc029c98009f4f142c7bbcc81eb');
    expect(markdown).toContain('`missing`');
    expect(markdown).toContain('`corrupt`');
    expect(markdown).toContain('`export-safety-fail`');
    expect(markdown).toContain('view-only');
  });
});
