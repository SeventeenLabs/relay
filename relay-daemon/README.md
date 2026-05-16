# relay-daemon (scaffold)

Relay daemon is the backend bridge between Relay Desktop and Hermes ACP.

Desktop <-> daemon: HTTPS + WebSocket
Daemon <-> Hermes: local stdio (`hermes acp`)

## MVP goals

- Authenticated HTTP + WS API
- Workspace allowlist
- Per-session Hermes ACP process lifecycle
- Real-time event fanout to clients
- Session abstraction separate from ACP internals

## Run

1) Configure env:

```bash
cp .env.example .env
```

2) Install deps:

```bash
npm install
```

3) Start in dev mode:

```bash
npm run dev
```

Server starts at `http://localhost:8787` by default.

## API

- `GET /health`
- `GET /v1/workspaces`
- `POST /v1/sessions`
- `GET /v1/sessions`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/input`
- `POST /v1/sessions/:id/approval`
- `POST /v1/sessions/:id/interrupt`
- `DELETE /v1/sessions/:id`
- `GET /v1/ws` (websocket upgrade)

Formal schema: `../docs/RELAY-DAEMON-API-SPEC.md`

## Notes

- This is a scaffold, not a production deployment.
- Persistence is currently in-memory.
- Approval semantics are pass-through placeholders until ACP tool-specific adapters are added.
