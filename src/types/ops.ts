/**
 * Types for Ops Viewer / ACS Integration
 */
export interface AuditGitV1 {
  kind: 'audit.git';
  schema_version: 'v1';
  ts: string;
  repo: string;
  cwd: string;
  status: 'ok' | 'warn' | 'error';
  facts: {
    head_sha: string | null;
    head_ref: string | null;
    is_detached_head: boolean;
    local_branch: string | null;
    upstream: { name: string; exists_locally: boolean } | null;
    remotes: string[];
    remote_default_branch: string | null;
    remote_refs: {
      origin_main: boolean;
      origin_head: boolean;
      origin_upstream: boolean;
    };
    working_tree: {
      is_clean: boolean;
      staged: number;
      unstaged: number;
      untracked: number;
    };
    ahead_behind: {
      ahead: number;
      behind: number;
    };
  };
  checks: Array<{
    id: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
    evidence?: unknown;
  }>;
  uncertainty: {
    level: number;
    causes: Array<{
      kind: string;
      note: string;
    }>;
    meta: 'productive' | 'avoidable' | 'systemic';
  };
  suggested_routines: Array<{
    id: string;
    risk: 'low' | 'medium' | 'high';
    mutating: boolean;
    dry_run_supported: boolean;
    reason: string;
    requires?: string[];
  }>;
}

export interface RoutinePreviewV1 {
  kind: 'routine.preview';
  id: string;
  mode: 'dry-run';
  mutating: boolean;
  risk: 'low' | 'medium' | 'high';
  steps: Array<{
    cmd: string;
    why: string;
  }>;
  confirm_token?: string;
}

export interface RoutineResultV1 {
  kind: 'routine.result';
  id: string;
  mode: 'apply';
  mutating: boolean;
  ok?: boolean;
  risk?: 'low' | 'medium' | 'high';
  steps?: Array<{
    cmd: string;
    why: string;
  }>;
  state_hash?: {
    before: string;
    after: string;
  };
  stdout?: string;
}
