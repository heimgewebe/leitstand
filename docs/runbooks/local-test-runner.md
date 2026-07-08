---
id: docs.runbooks.local-test-runner
title: Leitstand Local Test Runner Compatibility
status: active
doc_type: runbook
canonicality: canonical
summary: >
  Documents Heim-PC local Node/V8 runner limitations and the boundary between local checks and CI test truth.
---

# Leitstand Local Test Runner Compatibility

## Scope

This runbook documents a local Heim-PC runner limitation observed while validating Leitstand worktrees. It does not change CI expectations and does not lower the test gate.

GitHub CI remains the source of truth for the full Vitest suite.

## Observed local environment

Observed on the Heim-PC during the Leitstand operator-observability work:

| Check | Result |
| --- | --- |
| `node --version` | `v22.23.1` |
| `node -e "console.log('plain-node-ok')"` | exits `133` with a V8 fatal error before repo code runs |
| `NODE_OPTIONS=--jitless node -e "console.log('jitless-node-ok')"` | succeeds |
| `NODE_OPTIONS=--jitless pnpm --version` | `9.1.0` |
| `NODE_OPTIONS=--jitless pnpm lint` | succeeds |
| `NODE_OPTIONS=--jitless pnpm typecheck` | succeeds |
| `NODE_OPTIONS=--jitless pnpm build` | succeeds |
| `NODE_OPTIONS=--jitless pnpm test` | fails before tests with `ReferenceError: WebAssembly is not defined` from Vite/Vitest |

The default Node failure is a trivial-process failure, not a Leitstand test failure. The stack trace fails in V8 executable-memory permission setup (`SetPermissionsOnExecutableMemoryChunk`) before application code runs.

`NODE_OPTIONS=--jitless` is a valid local workaround for lint, typecheck and build. It is not a valid full-test workaround because Vite/Vitest requires WebAssembly, and `--jitless` disables the relevant WebAssembly exposure in this environment.

## Local command policy

On this Heim-PC, use these commands as local preflight evidence:

```bash
NODE_OPTIONS=--jitless pnpm lint
NODE_OPTIONS=--jitless pnpm typecheck
NODE_OPTIONS=--jitless pnpm build
python3 scripts/ai_context/validate_ai_context.py --file .ai-context.yml
bash scripts/ci/observer-invariant-guard.sh
bash scripts/ci/docs-relations-guard.sh
bash scripts/ci/generated-files-guard.sh
bash scripts/ci/check-drift-gates.sh
```

These commands exercise static analysis, TypeScript compilation, AI-context validation, observer-boundary checks, docs relations, generated-file gates and drift gates.

Do not claim full local Vitest success on this host unless `pnpm test` completes without the Node/V8 crash and without the WebAssembly failure.

## Full test truth

The full test gate remains:

```bash
pnpm test
```

That command is executed by GitHub Actions in `.github/workflows/ci.yml` using Node 20. Passing CI is required before merge. Do not skip tests, mark tests as flaky, or remove Vitest coverage merely to hide the Heim-PC local runner limitation.

## Diagnosis boundary

This runbook establishes only the observed local behavior on the Heim-PC. It does not prove whether the underlying cause is:

- specific to Node `v22.23.1`;
- specific to the host kernel/runtime hardening;
- specific to the local Node build;
- or a broader Node/V8 regression.

A future fix should use an isolated runtime comparison, for example Node 20 via an explicit toolchain or container, before changing package constraints or CI behavior.
