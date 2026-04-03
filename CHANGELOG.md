# Changelog

## v2026.4.3 - 2026-04-03

### Added
- External context references in cowork with @ mention insertion and project/external source labeling.
- Cowork approvals mode wiring and context window fallback plumbing in the cowork UI surface.
- CI workflow hardening for release validation with manual dispatch, concurrency guards, explicit permissions, timeout limits, and post-verify build checks.

### Changed
- Cowork is now the primary workspace flow; legacy chat mode routing was removed from the main app experience.
- Sidebar and settings chrome refined for clearer operator navigation and gateway status visibility.
- Cowork composer and streaming UX updated for smoother run feedback and centered layout stability.
- Project home external context actions now tolerate optional picker callbacks without type errors.

### Fixed
- TypeScript prop contract drift between app shell and cowork/project pages that blocked `npm run verify`.
- Keyboard event typing mismatch on global window listeners in cowork page effects.
- Release candidate verification path now passes lint/typecheck plus file safety and local action smoke tests.

## v2026.3.28 - 2026-03-28

### Added
- Default gateway profile persistence and startup selection support.
- Gateway discovery hints for connection failures.
- Cowork send watchdog and prep timeout handling to prevent stuck "Sending" state.
- Operator compiler module integration for project operator workflows.

### Changed
- Chat and cowork composer submit flows now consistently use their correct draft state.
- E2E cowork approval/project-context coverage updated to match current UI/system message behavior.
- Project and chat page hook ordering/lint compliance fixes for release verification.

### Fixed
- Regex-based control-character lint blockers replaced with safe code-point checks.
- Cowork approval tests now enforce deterministic safety-policy setup (global and project-scoped).
- Multiple false-negative E2E assertions around approval outcomes and artifact path display.
