# Relay Daemon Parity Spec (Best-Practice Baseline)

Status: authoritative implementation target unless explicitly overridden.

## 1) Source of truth
- SSH/ACP behavior is the canonical reference for runtime semantics.
- Relay daemon must match user-visible behavior across equivalent features.

## 2) Parity target
- Required: method-level parity for all `AgentBackendClient` methods supported by both transports.
- Allowed divergence only when transport constraints are explicit and surfaced in UI + docs.

## 3) Models
- Support per-session model read/set semantics.
- Persist selected model server-side per session.
- Accept and normalize IDs: `provider/model`, `provider:model`, `provider::model`.
- Return a canonical normalized ID to UI.

## 4) Tools catalog
- `fetchToolsCatalog()` must return real tools, not empty arrays.
- Add daemon endpoint for tools catalog and keep response schema stable.
- Include transport-agnostic fields consumed by UI.

## 5) Sessions
- Session metadata (title/model/status) is server-owned.
- `listSessions` and `get session` must reflect persisted metadata.
- Session lifecycle and event ordering must be deterministic.

## 6) Cron
- Daemon: cron fully supported.
- ACP direct: if unsupported, expose explicit capability flag and disable/hide controls in UI.
- No silent no-op behavior.

## 7) Workspace
- Maintain strict root confinement and path normalization.
- Error codes/messages consistent for invalid path, not found, permission denied.
- Keep read/write/rename/delete/list/stat semantics parity with ACP UX expectations.

## 8) Errors
- Normalize error envelope across transports:
  - `code` (stable machine key)
  - `message` (actionable human text)
  - optional `details`
- Avoid transport-specific cryptic leakage at UI boundary.

## 9) Timeouts/retries
- Standard defaults:
  - connect handshake timeout: 20s
  - websocket connect timeout: 10s
  - request timeout: 30s (long ops configurable)
- Retry only idempotent reads; never retry mutating writes without idempotency keys.

## 10) Capability discovery
- Add capability manifest endpoint (or equivalent) and wire UI gating to it.
- UI must not advertise features unsupported by active transport.

## 11) Testing standard (required)
- Transport-parity test matrix for each `AgentBackendClient` method.
- Golden contract tests for:
  - model set/get normalization
  - tools catalog non-empty schema validity
  - cron CRUD (daemon)
  - workspace path safety
  - error envelope normalization
- Regression tests for previous flip/coercion bugs.

## 12) Observability
- Namespaced logs with transport and request IDs.
- Include effective transport source (persisted/ui/runtime) in connect/save logs.
- Include route + status + normalized error code for failures.

## 13) Rollout discipline
- Test-first for parity gaps.
- Minimum-diff patches per gap.
- Verify with `npm run -s verify` + focused parity tests before merge.
