# Changelog

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
