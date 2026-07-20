---
id: docs.runbooks.local-release-runtime
title: Leitstand Local Release Runtime
doc_type: runbook
status: active
canonicality: canonical
summary: >
  Exact-head build, coupled user-systemd cutover, rollback and receipt contract.
---

# Leitstand Local Release Runtime

## Purpose

The canonical internal Leitstand runtime is deployed as an immutable, commit-bound local release. `scripts/leitstand-release.py` owns one narrow effect path for both versioned units:

- `leitstand.service`
- `leitstand-storage-health.service`

The adapter does not give Leitstand execution authority over Bureau, Grabowski, Systemkatalog, RepoGround, Heim-PC, DNS, TLS, Caddy or any external source system.

## Source and release identity

A build accepts:

- one exact 40-character `--expected-head`;
- one explicit `--required-ref`, default `origin/main`;
- one exact clean source checkout whose `HEAD`, local required ref, local `origin/main` and live `git ls-remote` result all equal that commit.

Full Git-dependent CI runs first in the exact clean source checkout. The adapter then re-reads live remote `main`, creates the release with `git archive`, and runs frozen installation, release-adapter tests and deterministic builds inside the archive. `SOURCE_DATE_EPOCH` is bound to the source commit timestamp. Uncommitted files cannot enter the release.

Release directory:

```text
~/.local/lib/leitstand/releases/<commit>-runtime-v1
```

Every release manifest binds source commit, source tree, origin URL, validation commands, release-tree digest and critical artifact digests.

## Runtime configuration

Host-specific source paths are not embedded in the repository. The effect commands read one exact-key JSON object, normally:

```text
~/.config/leitstand/runtime.json
```

Start from `deploy/systemd/runtime-config.example.json`. The configuration binds:

- canonical HTTPS origin;
- exact Systemkatalog release root and map manifest;
- Leitstand artifact root;
- Heim-PC repository root;
- storage-health state root.

Only an HTTPS origin and absolute whitespace-free paths are accepted. The canonical JSON digest is written into deployment evidence.

## Coupled unit transaction

The versioned templates are:

- `deploy/systemd/leitstand.service`
- `deploy/systemd/leitstand-storage-health.service`

Before any cutover, the adapter reads both installed unit files, both FragmentPaths, the running web process and the current release selectors. It then:

1. renders both templates for the exact target release and runtime configuration;
2. writes both unit files before one `daemon-reload`;
3. verifies content, mode and FragmentPath for both units;
4. records the previous managed release when one exists;
5. selects the target release atomically;
6. runs the versioned storage producer;
7. restarts the web service;
8. executes the complete postflight.

Any failed write, reload, producer run, restart or postflight restores both prior unit files and both selectors, reloads systemd and restarts the prior services. Restoration is independently read back and incomplete restoration is reported honestly.

During the first cutover from an unmanaged exact-path unit, the old release directory remains untouched. Its path, both previous unit hashes and create-only 0600 backup files containing the exact unit bytes are recorded before the first effect. Automatic failure restoration uses the exact pre-cutover unit bytes; the adapter does not invent a legacy manifest or copy a running tree into a second truth.

## Postflight

Success requires agreement between release manifest, user-systemd, process state and HTTP behavior:

- web unit loaded, active, running and stable;
- storage unit loaded with `Result=success` and `ExecMainStatus=0`;
- both FragmentPaths and WorkingDirectories match the target release;
- web process CWD matches the target release;
- listener is loopback-only on port 3000;
- local and canonical `/health` report the exact source commit and `status=ok`;
- Bureau and checkout snapshots use 20-minute limits;
- storage health uses 90 minutes;
- Systemkarte uses 168 hours;
- `/`, `/health`, `/bureau`, `/checkouts`, `/storage-health`, `/ecosystem-map` and `/repoground` return 200 locally and canonically;
- `/repobriefs` returns 301 with a structurally parsed target path `/repoground`;
- all removed routes and `POST /events` return 404;
- local map, browser module and Mermaid assets remain available.

Redirect verification uses parsed status and location fields. Raw CRLF-sensitive header matching is not part of the contract.

Canonical HTTPS verification never disables certificate validation. The adapter first uses Python's configured CA file. When the Python/OpenSSL build has no usable compiled CA file, it may use the first existing operating-system CA bundle from its fixed platform list. A fallback bundle is accepted only when it is a regular file owned by root and is not writable by group or others. If no trusted bundle is available or certificate verification fails, postflight fails and the coupled transaction restores the prior runtime.

## Receipts and idempotency

Build, switch, rollback, failure and deployment effects write create-only JSON receipts plus SHA-256 sidecars below:

```text
~/.local/state/leitstand/releases/receipts
```

A successful deployment also writes a completion record keyed by source commit and runtime-configuration digest. Repeating the identical deployment performs read-only unit and postflight verification and returns the existing completion instead of restarting services or rerunning the storage producer.

## Commands

Build without changing the running service:

```bash
python3 scripts/leitstand-release.py build \
  --source-repo /path/to/exact-checkout \
  --expected-head <origin-main-commit>
```

Build and deploy through the complete transaction:

```bash
python3 scripts/leitstand-release.py deploy \
  --source-repo /path/to/exact-checkout \
  --expected-head <origin-main-commit> \
  --runtime-config ~/.config/leitstand/runtime.json
```

Inspect or verify:

```bash
python3 scripts/leitstand-release.py status
python3 scripts/leitstand-release.py verify --target-head <commit>
```

Switch to an already verified managed release:

```bash
python3 scripts/leitstand-release.py switch \
  --target-head <commit> \
  --runtime-config ~/.config/leitstand/runtime.json
```

Rollback to the recorded previous managed release or an explicit managed commit:

```bash
python3 scripts/leitstand-release.py rollback \
  --runtime-config ~/.config/leitstand/runtime.json

python3 scripts/leitstand-release.py rollback \
  --target-head <commit> \
  --runtime-config ~/.config/leitstand/runtime.json
```

## Deliberate nonclaims

The adapter does not establish:

- authorization to deploy an unreviewed commit;
- correctness of source-system contents beyond the observed contracts;
- public internet exposure;
- future runtime or snapshot health;
- correctness of DNS, TLS or Caddy outside the verified canonical HTTP transaction;
- permission to alter foreign dirty worktrees, unrelated units or unrelated release directories.
