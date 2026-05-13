# Hermes Connection Modes (Docs-Aligned)

This project now follows Hermes docs strictly, with two explicit integration modes:

## 1) ACP Mode (`hermes_acp`)

Reference:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/

Contract:
- Relay uses ACP as a **stdio** protocol.
- Relay launches Hermes ACP using only documented commands:
  - `hermes acp`
  - `hermes-acp`
  - `python -m acp_adapter`
- Relay does not reinterpret ACP as OpenAI HTTP.

Implication:
- The runtime where Relay executes must be able to launch one of the commands above.

## 2) API Server Mode (`hermes_http`)

Reference:
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/

Contract:
- Relay talks to Hermes API Server as OpenAI-compatible HTTP endpoint:
  - `http://<host>:8642/v1`
- Relay uses `/v1/models` and `/v1/chat/completions` style requests.

## Architecture Basis

Reference:
- https://hermes-agent.nousresearch.com/docs/developer-guide/architecture

Hermes exposes multiple entry points (CLI, Gateway/API Server, ACP). Relay maps those to explicit, non-guessing transports above.

## Non-Goals

- No hidden mode switching based on endpoint shape.
- No undocumented transport assumptions.
