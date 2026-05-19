# Relay Codex-Usability Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Make Relay usable as a daily coding cockpit so Christian can work on real projects with a Codex-like loop (plan → edit → run/tests → inspect diffs → approve → iterate) without transport confusion.

Architecture: Introduce a strict capability contract per transport (ACP SSH, daemon, HTTP), then gate/shape UI by those capabilities. Break oversized orchestration out of App.tsx into focused modules for capabilities, session reliability, approvals, and coding actions.

Tech Stack: Electron + React + TypeScript, existing Relay backend clients (HermesAcpClient/HermesHttpClient/RelayDaemonClient), Playwright e2e.

---

## Codex-like parity matrix (implementation targets)

### Must-have (ship first)
1. Reliable coding loop in one place
   - Inspect project tree/files
   - Run terminal commands/tests quickly
   - Review diff/changes
   - Apply/approve file actions clearly
2. Strict transport behavior
   - ACP over SSH never silently falls back
   - Feature availability explicit per transport
   - Clear logs for active transport and capability source
3. Fast composer ergonomics
   - Slash commands for common coding actions
   - Drag/drop + paste files/images into cowork composer
4. Session reliability
   - Resume/reconnect/history sync stable and deterministic
5. Approval UX for coding edits
   - Low-friction approve/deny with concise previews
6. Local file handling must be rock-solid
   - Reliable file reads/writes/rename/delete in selected project folder
   - Strong path safety (no accidental out-of-scope writes)
   - Clear errors for permission/path/binary/size edge cases
   - Predictable behavior on Windows+WSL paths

### Nice-to-have (phase 2)
1. Cloud delegation UX parity
2. Deep web-search panel UX parity
3. Rich model/reasoning advanced controls parity
4. In-app browser/computer-use parity

---

## Phase 0: Baseline + guardrails

### Task 0.1: Freeze behavior baseline and create parity checklist doc
Objective: Capture current behavior and define measurable acceptance checks.

Files:
- Create: docs/plans/relay-codex-usability-checklist.md
- Modify: none
- Test: none

Step 1: Write checklist doc with binary pass/fail checks for each must-have target.

Step 2: Include manual dogfood scenario:
- Open project
- Ask Relay to implement a small feature
- Inspect proposed changes
- Approve selected edits
- Run tests
- iterate until green

Step 3: Commit
Run:
- git add docs/plans/relay-codex-usability-checklist.md
- git commit -m "docs: add codex-usability acceptance checklist"

---

## Phase 1: Strict transport capability contract

### Task 1.1: Add typed transport capabilities model
Objective: Centralize feature support in a single contract instead of scattered stubs.

Files:
- Create: src/lib/transport-capabilities.ts
- Modify: src/lib/agent-backend-client.ts
- Test: tests/e2e/transport-config.spec.ts

Step 1: Add transport capability types:
- supportsCron
- supportsToolsCatalog
- supportsKanban
- supportsWorkspaceFs
- supportsTerminalActions
- supportsImagesInComposer
- supportsSlashCommands

Step 2: Add API on backend client interface:
- getCapabilities(): TransportCapabilities

Step 3: Implement per-client capability returns:
- HermesAcpClient
- HermesHttpClient
- RelayDaemonClient

Step 4: Keep behavior strict:
- If unsupported, explicitly throw not_supported (no fake [] success unless truly semantically correct list-empty state).

Step 5: Run targeted tests
Run:
- npm run test -- tests/e2e/transport-config.spec.ts
Expected: PASS

Step 6: Commit
- git add src/lib/transport-capabilities.ts src/lib/agent-backend-client.ts src/lib/hermes-acp-client.ts src/lib/hermes-http-client.ts src/lib/relay-daemon-client.ts tests/e2e/transport-config.spec.ts
- git commit -m "feat: add strict transport capability contract"

### Task 1.2: Wire UI gating to capabilities
Objective: Remove implicit behavior and gate views/actions from declared capabilities.

Files:
- Modify: src/App.tsx
- Modify: src/features/workspace/scheduled-page.tsx
- Modify: src/features/cowork/cowork-page.tsx
- Test: tests/e2e/transport-config.spec.ts

Step 1: Fetch capabilities once per connected client generation and store in app state.

Step 2: Gate cron/scheduled UI on supportsCron.

Step 3: Gate catalog-dependent or feature toggles on supportsToolsCatalog.

Step 4: Show clear inline reason when disabled: "Not available on current transport (hermes_acp_stdio|hermes_http|relay_daemon)".

Step 5: Add deterministic status/log line indicating active transport and capability snapshot.

Step 6: Run tests
- npm run test -- tests/e2e/transport-config.spec.ts
Expected: PASS

Step 7: Commit
- git add src/App.tsx src/features/workspace/scheduled-page.tsx src/features/cowork/cowork-page.tsx tests/e2e/transport-config.spec.ts
- git commit -m "feat: gate workspace features by transport capabilities"

---

## Phase 2: Composer power tools for coding flow

### Task 2.1: Add slash-command parser + command palette hints
Objective: Fast command entry like Codex for common coding actions.

Files:
- Create: src/features/cowork/slash-commands.ts
- Modify: src/features/cowork/components/cowork-composer.tsx
- Modify: src/features/cowork/cowork-page.tsx
- Test: tests/e2e/cowork-selectors.spec.ts

Step 1: Define slash commands:
- /plan
- /diff
- /test [cmd]
- /run [cmd]
- /open [path]
- /review

Step 2: Add parser returning structured command object.

Step 3: Add inline suggestion list when input starts with '/'.

Step 4: Route parsed commands to existing cowork action path.

Step 5: Tests:
- command suggestions appear
- selecting a command populates structured action

Step 6: Run tests
- npm run test -- tests/e2e/cowork-selectors.spec.ts
Expected: PASS

Step 7: Commit
- git add src/features/cowork/slash-commands.ts src/features/cowork/components/cowork-composer.tsx src/features/cowork/cowork-page.tsx tests/e2e/cowork-selectors.spec.ts
- git commit -m "feat: add slash commands for cowork coding actions"

### Task 2.2: Enable drag/drop + paste attachments in composer
Objective: Allow coding context via screenshots/snippets/files quickly.

Files:
- Modify: src/features/cowork/components/cowork-composer.tsx
- Modify: src/features/cowork/cowork-page.tsx
- Modify: src/lib/chat-utils.ts (if shared helpers are needed)
- Test: tests/e2e/cowork-selectors.spec.ts

Step 1: Add drag-over/drop handlers in composer.

Step 2: Add paste handler for clipboard files/images.

Step 3: Show small attachment chips with remove action before send.

Step 4: Append attachment metadata into outbound cowork request context.

Step 5: Add basic size/type validation with user-visible errors.

Step 6: Run tests
- npm run test -- tests/e2e/cowork-selectors.spec.ts
Expected: PASS

Step 7: Commit
- git add src/features/cowork/components/cowork-composer.tsx src/features/cowork/cowork-page.tsx src/lib/chat-utils.ts tests/e2e/cowork-selectors.spec.ts
- git commit -m "feat: add drag-drop and paste attachments in cowork composer"

---

## Phase 3: Coding workspace loop (daily-driver path)

### Task 3.1: Add quick coding actions panel
Objective: One-click common coding operations.

Files:
- Create: src/features/workspace/coding-actions-panel.tsx
- Modify: src/features/workspace/files-page.tsx
- Modify: src/features/workspace/activity-page.tsx
- Test: tests/e2e/project-context.spec.ts

Step 1: Add panel actions:
- Refresh git status
- Show diff summary
- Run test command
- Run lint command
- Open changed files

Step 2: Connect actions to existing terminal/local-action infrastructure.

Step 3: Add command presets editable in settings (or local constants initially; YAGNI).

Step 4: Run tests
- npm run test -- tests/e2e/project-context.spec.ts
Expected: PASS

Step 5: Commit
- git add src/features/workspace/coding-actions-panel.tsx src/features/workspace/files-page.tsx src/features/workspace/activity-page.tsx tests/e2e/project-context.spec.ts
- git commit -m "feat: add quick coding actions panel"

### Task 3.2: Improve diff/review flow between proposed and applied edits
Objective: Make approval + review loop obvious and fast.

Files:
- Modify: src/features/workspace/files-page.tsx
- Modify: src/features/workspace/approvals-page.tsx
- Modify: src/features/cowork/components/pending-approvals-panel.tsx
- Test: tests/e2e/project-context.spec.ts

Step 1: Add “before/after” entry point from approval item to diff view.

Step 2: Link applied action receipts to file preview selection.

Step 3: Add compact review summary (files changed, lines added/removed if available).

Step 4: Run tests
- npm run test -- tests/e2e/project-context.spec.ts
Expected: PASS

Step 5: Commit
- git add src/features/workspace/files-page.tsx src/features/workspace/approvals-page.tsx src/features/cowork/components/pending-approvals-panel.tsx tests/e2e/project-context.spec.ts
- git commit -m "feat: tighten diff and approval review loop"

---

## Phase 4: Session/resume reliability hardening

### Task 4.1: Extract session sync orchestration from App.tsx
Objective: Reduce fragility by isolating resume/history logic.

Files:
- Create: src/app/session-sync.ts
- Modify: src/App.tsx
- Test: tests/e2e/transport-config.spec.ts

Step 1: Move session-key resolution and history sync helpers to session-sync.ts.

Step 2: Keep behavior identical first (pure extraction).

Step 3: Add deterministic retry policy + bounded backoff for history fetch.

Step 4: Ensure optimistic message race protections still pass.

Step 5: Run tests
- npm run test -- tests/e2e/transport-config.spec.ts
Expected: PASS

Step 6: Commit
- git add src/app/session-sync.ts src/App.tsx tests/e2e/transport-config.spec.ts
- git commit -m "refactor: extract session sync orchestration from App"

### Task 4.2: Add resume/reconnect regression tests
Objective: Prevent relapses in lost/duplicated assistant output.

Files:
- Modify: tests/e2e/transport-config.spec.ts
- Modify: tests/e2e/cowork-selectors.spec.ts

Step 1: Add scenario:
- send cowork request
- simulate delayed stream/drop
- verify history sync restores assistant output exactly once

Step 2: Add reconnect scenario for ACP transport.

Step 3: Run tests
- npm run test -- tests/e2e/transport-config.spec.ts tests/e2e/cowork-selectors.spec.ts
Expected: PASS

Step 4: Commit
- git add tests/e2e/transport-config.spec.ts tests/e2e/cowork-selectors.spec.ts
- git commit -m "test: add resume and reconnect reliability regressions"

---

## Phase 5: Approval UX cleanup and performance

### Task 5.1: Extract approval orchestration service
Objective: Replace giant inline approval logic with testable module.

Files:
- Create: src/features/cowork/approval-orchestrator.ts
- Modify: src/App.tsx
- Modify: src/features/cowork/components/pending-approvals-panel.tsx
- Test: tests/e2e/project-context.spec.ts

Step 1: Move policy evaluation + approval lifecycle bookkeeping into approval-orchestrator.ts.

Step 2: Keep same external events and state transitions.

Step 3: Slim App.tsx by replacing inline blocks with service calls.

Step 4: Run tests
- npm run test -- tests/e2e/project-context.spec.ts
Expected: PASS

Step 5: Commit
- git add src/features/cowork/approval-orchestrator.ts src/App.tsx src/features/cowork/components/pending-approvals-panel.tsx tests/e2e/project-context.spec.ts
- git commit -m "refactor: extract cowork approval orchestrator"

---

## Phase 5.5: Local file handling hardening (selected folder only)

### Task 5.5.1: Define strict local file-ops contract
Objective: Make local file behavior deterministic and safe in the selected project scope.

Files:
- Create: docs/plans/relay-local-file-ops-spec.md
- Modify: src/lib/file-service.ts
- Modify: src/lib/connectors/filesystem.ts
- Test: tests/e2e/project-context.spec.ts

Step 1: Document contract for read/write/append/replace/rename/delete/list/stat:
- Allowed scope: selected root only
- Path normalization rules (Windows/WSL)
- Error taxonomy (not_found, permission_denied, out_of_scope, binary_unsupported, size_limit)

Step 2: Implement shared path normalizer + scope guard used by all local file ops.

Step 3: Ensure every operation returns structured, user-actionable error details.

Step 4: Run tests
- npm run test -- tests/e2e/project-context.spec.ts
Expected: PASS

Step 5: Commit
- git add docs/plans/relay-local-file-ops-spec.md src/lib/file-service.ts src/lib/connectors/filesystem.ts tests/e2e/project-context.spec.ts
- git commit -m "feat: define and enforce strict local file operations contract"

### Task 5.5.2: Add edge-case regression tests for local file ops
Objective: Prevent local file handling regressions on real project folders.

Files:
- Modify: tests/e2e/project-context.spec.ts
- Create: tests/e2e/local-file-ops.spec.ts

Step 1: Add tests for:
- write/read/rename/delete success in selected folder
- reject ../ traversal and absolute out-of-scope paths
- handle Windows-style and WSL-style paths predictably
- binary/large file preview behavior
- permission denied surfaces clear error

Step 2: Run tests
- npm run test -- tests/e2e/project-context.spec.ts tests/e2e/local-file-ops.spec.ts
Expected: PASS

Step 3: Commit
- git add tests/e2e/project-context.spec.ts tests/e2e/local-file-ops.spec.ts
- git commit -m "test: add local file handling regression coverage"

---

## Phase 6: End-to-end dogfood release gate

### Task 6.1: Add scripted dogfood scenario and acceptance gate
Objective: Prove Relay can complete a real coding task loop before shipping.

Files:
- Create: scripts/codex-usability-dogfood.mjs
- Create: docs/plans/relay-codex-usability-dogfood-report-template.md
- Modify: package.json (script entry)

Step 1: Script checks:
- transport capability snapshot logged
- slash command entry works
- propose edits and approval flow exercised
- run test command and capture result
- verify diff/review view reachable

Step 2: Add npm script:
- npm run dogfood:codex-usability

Step 3: Add report template for pass/fail with blockers.

Step 4: Run script
- npm run dogfood:codex-usability
Expected: exit 0 + report artifact

Step 5: Commit
- git add scripts/codex-usability-dogfood.mjs docs/plans/relay-codex-usability-dogfood-report-template.md package.json
- git commit -m "chore: add codex-usability dogfood release gate"

---

## Diff hygiene guardrails (required during implementation)

For every task touching existing files:
1. Inspect narrow diff only for touched paths.
   - git diff -- <file>
2. Check churn size.
   - git diff --stat -- <file>
3. If unexpectedly huge rewrite appears, stop and reapply surgical patch.
4. Avoid mixed formatting/line-ending churn in logic commits.

---

## Verification commands (full sweep)

Run:
- npm run lint
- npm run typecheck
- npm run test -- tests/e2e/transport-config.spec.ts tests/e2e/cowork-selectors.spec.ts tests/e2e/project-context.spec.ts
- npm run dogfood:codex-usability

Expected:
- All commands exit 0
- No transport ambiguity in logs
- Must-have parity checklist fully PASS

---

## Notes
- Primary target is your workflow (coding projects) not generic feature breadth.
- ACP/SSH strictness remains non-negotiable: no hidden local fallback.
- We prioritize “works every day” over “feature count”.
