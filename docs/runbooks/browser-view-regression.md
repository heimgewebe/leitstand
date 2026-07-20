---
id: runbook.browser-view-regression
title: Browser view regression
status: active
doc_type: runbook
canonicality: supporting
summary: >
  Build-bound Playwright regression contract for the primary read-only Leitstand views.
---

# Browser view regression

## Purpose

`pnpm run test:browser-views` tests the built Leitstand application rather than a
synthetic HTML shell. It imports `dist/server.js`, binds the Express server to an
ephemeral loopback port and visits the primary routes listed in
`scripts/browser-view-matrix.v1.json`.

The command requires a current `pnpm run build`. CI therefore runs it immediately
after the build step.

## Contract

The runner:

- uses the actual EJS views, product CSS, product JavaScript and lockfile-bound Mermaid asset;
- checks each primary view at 390×844 and 1440×900;
- rejects document overflow and elements that escape the viewport;
- exercises skip-link focus and mobile navigation focus restoration;
- exercises the system-map fullscreen dialog, focus trap and Escape restoration;
- covers valid, missing, corrupt, stale, empty and reduced-motion states;
- fails on page errors, console errors, failed requests and same-origin HTTP 4xx/5xx responses;
- records the exact Git commit, build-tree digest, matrix digest, viewports and loaded asset paths.

No CSS is injected by the test harness. Layout checks therefore observe the
styles delivered by Leitstand itself. The runner creates temporary local
fixtures and a temporary Git repository for the Systemkatalog map contract; it
does not mutate external systems or source artifacts.

## Evidence modes

Missing, corrupt, stale and empty inputs are controlled fixture scenarios. They
prove the browser behavior of degraded states and do not claim that a matching
live incident occurred. The result receipt is build-bound evidence, not source
truth, runtime correctness or visual perfection.

## Failure handling

A failure leaves production untouched. Fix the product or the versioned matrix,
rebuild and rerun the command. Do not add harness CSS or ignore browser errors to
make the check pass.
