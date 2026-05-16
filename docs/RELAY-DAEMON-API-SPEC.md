# Relay Daemon API + WebSocket Protocol (MVP v1)

Status: draft-for-implementation
Owner: Relay
Purpose: define the transport contract between Relay Desktop and Relay Daemon, with Hermes ACP behind the daemon.

## 1) High-level contract

- Desktop talks only to Relay Daemon over HTTPS + WebSocket.
- Relay Daemon talks to Hermes ACP over local stdio (`hermes acp`).
- ACP is never internet-exposed.
- Daemon session ID is stable and distinct from ACP runtime IDs.

Identity mapping:

- `relay_session_id` (daemon-owned, stable)
- `acp_process_id` (daemon process metadata)
- `acp_session_id` (if surfaced by ACP)

## 2) Auth

MVP: bearer token shared secret.

- HTTP: `Authorization: Bearer <token>`
- WebSocket: either
  - `Authorization: Bearer <token>` header, or
  - `?token=<token>` query param (fallback)

Production recommendation:
- replace with short-lived JWT + refresh + per-user scopes.

## 3) Workspace model

Daemon is configured with allowlisted workspace roots.
All session creation must reference a workspace key known to daemon.
Daemon resolves and validates real path before spawn.

## 4) HTTP API

Base path: `/v1`

### GET /health

Response:
```json
{
  "ok": true,
  "service": "relay-daemon",
  "uptimeSec": 123,
  "version": "0.1.0"
}
```

### GET /v1/workspaces

Response:
```json
{
  "workspaces": [
    {
      "key": "relay",
      "path": "/projects/relay"
    }
  ]
}
```

### POST /v1/sessions

Request:
```json
{
  "workspace": "relay",
  "label": "Feature sprint"
}
```

Response:
```json
{
  "session": {
    "id": "rs_01J...",
    "workspace": "relay",
    "workspacePath": "/projects/relay",
    "status": "starting",
    "createdAt": "2026-05-16T12:00:00.000Z"
  }
}
```

### GET /v1/sessions

Response:
```json
{
  "sessions": [
    {
      "id": "rs_01J...",
      "workspace": "relay",
      "workspacePath": "/projects/relay",
      "status": "ready",
      "createdAt": "2026-05-16T12:00:00.000Z",
      "updatedAt": "2026-05-16T12:01:20.000Z"
    }
  ]
}
```

### GET /v1/sessions/:id

Response:
```json
{
  "session": {
    "id": "rs_01J...",
    "workspace": "relay",
    "workspacePath": "/projects/relay",
    "status": "ready",
    "createdAt": "2026-05-16T12:00:00.000Z",
    "updatedAt": "2026-05-16T12:01:20.000Z"
  }
}
```

### POST /v1/sessions/:id/input

Request:
```json
{
  "text": "Refactor onboarding transport resolver"
}
```

Response:
```json
{
  "accepted": true
}
```

### POST /v1/sessions/:id/approval

Request:
```json
{
  "decision": "approve",
  "approvalId": "ap_01J...",
  "reason": "safe in workspace"
}
```

Response:
```json
{
  "accepted": true
}
```

`decision` enum: `approve | deny`

### POST /v1/sessions/:id/interrupt

Response:
```json
{
  "accepted": true
}
```

### DELETE /v1/sessions/:id

Response:
```json
{
  "deleted": true
}
```

## 5) WebSocket protocol

Endpoint: `/v1/ws`

Envelope:
```json
{
  "type": "<event_or_command_type>",
  "requestId": "optional-client-correlation-id",
  "sessionId": "optional-relay-session-id",
  "ts": "2026-05-16T12:00:00.000Z",
  "payload": {}
}
```

### Client -> daemon commands

- `list_sessions`
- `create_session`
- `subscribe_session`
- `send_input`
- `approval_decision`
- `interrupt_session`
- `close_session`
- `ping`

Examples:

```json
{ "type": "create_session", "requestId": "r1", "payload": { "workspace": "relay", "label": "Main" } }
```

```json
{ "type": "send_input", "requestId": "r2", "sessionId": "rs_01J...", "payload": { "text": "Run typecheck" } }
```

### Daemon -> client events

Core lifecycle:
- `ack`
- `error`
- `pong`
- `session_created`
- `session_updated`
- `session_closed`

Streaming/runtime:
- `stream_delta`
- `stream_final`
- `run_activity`
- `approval_required`
- `approval_resolved`
- `process_exit`

Examples:

```json
{
  "type": "session_created",
  "requestId": "r1",
  "sessionId": "rs_01J...",
  "payload": {
    "workspace": "relay",
    "status": "starting"
  }
}
```

```json
{
  "type": "stream_delta",
  "sessionId": "rs_01J...",
  "payload": {
    "text": "I am checking App.tsx..."
  }
}
```

```json
{
  "type": "approval_required",
  "sessionId": "rs_01J...",
  "payload": {
    "approvalId": "ap_01J...",
    "kind": "shell_command",
    "summary": "rm -rf node_modules",
    "timeoutSec": 300
  }
}
```

## 6) Error model

HTTP errors:
```json
{
  "error": {
    "code": "workspace_not_found",
    "message": "Unknown workspace key: marketing"
  }
}
```

WS errors use `type: "error"` and same payload shape.

Common error codes:
- `unauthorized`
- `invalid_request`
- `workspace_not_found`
- `session_not_found`
- `acp_not_ready`
- `acp_write_failed`
- `internal_error`

## 7) Reliability requirements

- Per-session ACP process supervisor with restart budget.
- Heartbeat (`ping`/`pong`) to detect dead sockets.
- Session metadata persisted (MVP can be in-memory; production use SQLite/Postgres).
- Structured logs for all command/event transitions.

## 8) Security requirements (non-negotiable)

- Do not expose ACP directly.
- Enforce workspace allowlist + realpath checks.
- Auth required on all routes/sockets.
- Never trust client-provided filesystem paths outside registered workspaces.
- Maintain append-only event log for auditability.
