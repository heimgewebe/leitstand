import { AuditGitV1, RoutinePreviewV1, RoutineResultV1 } from '../types/ops.js';

export async function getGitAudit(repo: string): Promise<AuditGitV1> {
  // STUB: Simulate the specific error case requested in the blueprint
  // "origin/main missing", "origin/HEAD dangling"

  return {
    kind: 'audit.git',
    schema_version: 'v1',
    ts: new Date().toISOString(),
    repo: repo,
    cwd: '/opt/weltgewebe', // Mock
    status: 'error',
    facts: {
      head_sha: 'a1b2c3d4e5f6',
      head_ref: 'refs/heads/zweig6',
      is_detached_head: false,
      local_branch: 'zweig6',
      upstream: { name: 'origin/zweig6', exists_locally: true },
      remotes: ['origin'],
      remote_default_branch: null, // dangling
      remote_refs: {
        origin_main: false, // ERROR
        origin_head: false, // ERROR
        origin_upstream: true
      },
      working_tree: {
        is_clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0
      },
      ahead_behind: {
        ahead: 0,
        behind: 0
      }
    },
    checks: [
      { id: 'git.repo.present', status: 'ok', message: 'Repo detected.' },
      { id: 'git.remote.origin.present', status: 'ok', message: 'Remote origin present.' },
      { id: 'git.fetch.ok', status: 'ok', message: 'Fetched remote refs.' },
      { id: 'git.remote_head.discoverable', status: 'error', message: 'origin/HEAD missing or dangling.' },
      { id: 'git.origin_main.present', status: 'error', message: 'refs/remotes/origin/main missing.' }
    ],
    uncertainty: {
      level: 0.15,
      causes: [
        { kind: 'remote_ref_inconsistency', note: 'Remote tracking refs may be incomplete or pruned unexpectedly.' }
      ],
      meta: 'productive'
    },
    suggested_routines: [
      {
        id: 'git.repair.remote-head',
        risk: 'low',
        mutating: true,
        dry_run_supported: true,
        reason: 'origin/HEAD missing/dangling; restore remote head + refs.'
      }
    ]
  };
}

export async function previewRoutine(_repo: string, routineId: string): Promise<RoutinePreviewV1> {
  // STUB: Preview for git.repair.remote-head
  if (routineId === 'git.repair.remote-head') {
    return {
      kind: 'routine.preview',
      id: routineId,
      mode: 'dry-run',
      mutating: true,
      risk: 'low',
      steps: [
        { cmd: 'git remote set-head origin --auto', why: 'Restore origin/HEAD from remote HEAD' },
        { cmd: 'git fetch origin --prune', why: 'Rebuild remote-tracking refs after head repair' }
      ],
      confirm_token: 'valid-token-123'
    };
  }

  throw new Error(`Routine ${routineId} not found`);
}

export async function applyRoutine(_repo: string, routineId: string, token?: string): Promise<RoutineResultV1> {
  // STUB: Apply success
  if (token !== 'valid-token-123') {
    throw new Error('Invalid or missing confirmation token');
  }

  return {
    kind: 'routine.result',
    id: routineId,
    mode: 'apply',
    mutating: true,
    risk: 'low',
    steps: [
      { cmd: 'git remote set-head origin --auto', why: 'Restore origin/HEAD from remote HEAD' },
      { cmd: 'git fetch origin --prune', why: 'Rebuild remote-tracking refs after head repair' }
    ],
    state_hash: {
      before: 'e5f6...',
      after: 'a1b2...'
    },
    stdout: 'origin/HEAD set to master\nFrom github.com:heimgewebe/metarepo\n * [new branch]      main       -> origin/main'
  };
}
