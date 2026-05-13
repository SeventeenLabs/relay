# Hermes Connection Transparency

This document explains exactly how Relay talks to Hermes so the runtime is not a black box.

## Runtime surfaces

- Gateway API (OpenAI-compatible): `http://127.0.0.1:8642/v1`
- Dashboard UI/API (model management): `http://127.0.0.1:9119`
- Transport mode (today): `hermes_http` (default) or `hermes_acp` (stub only)

Source of truth defaults:
- [`src/lib/hermes-constants.ts`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/lib/hermes-constants.ts)

## Connection flow

1. UI settings and onboarding write `gatewayUrl`, token, and transport into app state.
2. [`src/App.tsx`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/App.tsx) creates the backend client via `createDefaultBackendClient(...)`.
3. [`src/lib/agent-backend-client.ts`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/lib/agent-backend-client.ts) selects:
   - [`HermesGatewayClient`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/lib/hermes-gateway-client.ts) for HTTP mode
   - [`HermesAcpClient`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/lib/hermes-acp-client.ts) for ACP mode (currently a stub)
4. `HermesGatewayClient.connect()` normalizes URL and validates `/models`.
5. Chat uses `/chat/completions` with session history tracked in-memory by the client.

## Model routing flow

- Renderer asks Electron preload APIs:
  - `hermes:model-options`
  - `hermes:model-set-main`
- Handlers are implemented in [`electron/main.ts`](/C:/Users/chris/Documents/dev/openclaw-cowork/electron/main.ts).
- Electron reads dashboard token from dashboard HTML, then calls dashboard endpoints with `X-Hermes-Session-Token`.

## Why some features look unavailable

In OpenAI-compatible HTTP mode, these methods intentionally throw `not_supported` / `method_not_found` in [`src/lib/hermes-gateway-client.ts`](/C:/Users/chris/Documents/dev/openclaw-cowork/src/lib/hermes-gateway-client.ts):

- `cron.*` endpoints
- `workspace.*` endpoints

This is expected until those APIs are enabled on the Hermes side or Relay is wired to a richer transport.

## Quick diagnostics

Run:

```bash
npm run doctor:hermes
```

Optional overrides:

```bash
HERMES_GATEWAY_URL=http://host:8642/v1 HERMES_DASHBOARD_URL=http://host:9119/ npm run doctor:hermes
```

Doctor script:
- [`scripts/hermes-doctor.mjs`](/C:/Users/chris/Documents/dev/openclaw-cowork/scripts/hermes-doctor.mjs)

