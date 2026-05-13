# Relay Cleanup Master Plan (Stability + Architecture Reset)

Goal
- Stabilize Relay first, then systematically refactor into a clean, testable architecture with predictable UX and fewer regressions.

Non-negotiables
- No feature work until stabilization gates are green.
- One source of truth per domain (config, connection, session, models, approvals).
- Typed contracts between layers (Electron main <-> preload <-> renderer).
- Small PRs, each with tests.

---

## Phase 0 — Stop the bleeding (1-2 days)

1) Freeze feature development
- Branch: `cleanup/relay-stability-reset`
- Only allow fixes and refactors in this branch.

2) Baseline quality gates
- Required pass gates:
  - `npm run -s typecheck`
  - `npm run -s test:file-safety`
  - `npm run -s test:local-actions`
- Lint policy: no new errors; warning count must trend down each PR.

3) Create failure ledger
- File: `docs/quality/failure-ledger.md`
- Track every reproducible bug with:
  - symptom
  - root cause
  - fix PR
  - regression test link

4) Fix known hard blockers immediately
- Blocking lint error in `src/App.tsx` (`prefer-const`)
- stale/fragile smoke assertions and flaky checks

Deliverable
- CI green for required gates and documented bug ledger.

---

## Phase 1 — Architectural untangling (3-5 days)

Problem today
- `src/App.tsx` is overloaded (state orchestration, transport logic, domain behavior, UI decisions all mixed).

Target structure
- `src/core/` (pure domain logic)
  - `config/`
  - `sessions/`
  - `models/`
  - `approvals/`
  - `activity/`
- `src/adapters/`
  - `backend/http/`
  - `backend/acp/` (stub, then implementation)
  - `electron/`
- `src/features/` (UI-only composition)
- `src/state/` (single store or reducer modules)

Key refactor rules
- Move logic out of React components into pure functions first.
- Each extracted module gets unit tests.
- Keep behavior identical until tests prove parity.

Deliverable
- `App.tsx` reduced to composition/wiring.
- Domain logic modules independently testable.

---

## Phase 2 — Connection and model UX rewrite (2-3 days)

Primary user complaint
- Connection feels clunky; model selection confusing.

Fixes
1) Connection state machine
- Explicit states: `idle -> connecting -> connected -> degraded -> disconnected`
- One reducer owns connection transitions.

2) Model source truth
- Query model options from active runtime source first.
- If dashboard API used, show source badge in UI.
- On source mismatch, show actionable warning (not silent fallback).

3) Fast reconnect UX
- Retry button with diagnostics.
- Last-known good endpoint/profile displayed.
- Deterministic error text (network/auth/provider mismatch).

Deliverable
- Predictable connection behavior and model list consistency.

---

## Phase 3 — Approval/safety hardening (2-3 days)

Goals
- Make approval flow explicit, auditable, and less error-prone.

Work
- Standardize decision enum: `allow_once | allow_always | deny`
- Persist allow-always at scope level with clear revoke UI.
- Timeout always defaults to deny.
- Add audit trail entries for each decision.

Deliverable
- Approval system with clear policy semantics and regression tests.

---

## Phase 4 — Testing strategy upgrade (3-4 days)

Current issue
- Too many bugs = weak regression net.

Target test pyramid
- Unit tests: extracted core modules
- Integration tests: backend adapter contracts
- E2E tests: top critical user journeys

Critical E2E journeys
1) Connect + load models + switch model
2) Start cowork run + stream + finalize
3) Approval required + allow/deny paths
4) Local actions with safety boundaries

Deliverable
- Reproducible test suite that catches current bug classes.

---

## Phase 5 — Code quality and maintainability (ongoing)

Enforce
- Strict TypeScript for new/changed modules.
- Shared schema validation for IPC payloads.
- No implicit any in new code.
- No direct side-effects in render paths.

Lint debt burn-down
- Set weekly reduction target (e.g., -20 warnings/week).
- Block merges that increase warning count.

Documentation
- `docs/architecture/relay-runtime.md`
- `docs/architecture/backend-adapter-contract.md`
- `docs/ops/troubleshooting-connection-models.md`

---

## Execution order (recommended)

Sprint A (stabilize)
- Phase 0 + first part of Phase 2 (connection state machine)

Sprint B (untangle)
- Phase 1 extraction + unit tests

Sprint C (safety + UX)
- Phase 2 remainder + Phase 3

Sprint D (confidence)
- Phase 4 + lint debt reduction start

---

## Definition of done for “cleanup complete”

- Required gates always green.
- No critical known bugs in failure ledger.
- `App.tsx` no longer monolithic orchestration hub.
- Connection/model UX deterministic with clear source-of-truth.
- Approval flow standardized and audited.
- Regression suite covers critical journeys.

---

## Immediate next 5 implementation tasks

1) Create `docs/quality/failure-ledger.md` and seed with current top 10 bugs.
2) Fix the single blocking lint error (`prefer-const`) and keep it fixed in CI.
3) Extract connection state machine into `src/core/connection/state-machine.ts` with tests.
4) Add model source badge + mismatch warning in settings/UI.
5) Add adapter contract tests for model listing and session model selection.

Owner
- Execute all changes behind `cleanup/relay-stability-reset` with small, reviewable commits.
