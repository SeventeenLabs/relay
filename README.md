<p align="center">
  <img src="assets/abstract-svg/relay-abstract-01-operator-desk.svg" alt="Relay operator desk" width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="#features"><strong>Features</strong></a> &middot;
  <a href="#development"><strong>Development</strong></a> &middot;
  <a href="#community"><strong>Community</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f" alt="Electron" />
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-646cff" alt="React + Vite" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6" alt="TypeScript" />
</p>

<br/>

## What Is Relay?

# Open-source cowork interface for OpenClaw operators

**If OpenClaw is the runtime, Relay is the operator desk.**

Relay is an Electron desktop app for running AI work with human oversight. It combines chat, cowork execution, workspace context, and operator controls in one interface.

It looks simple on the surface, but under the hood it is designed for approvals, execution context, and day-to-day operational visibility.

**Manage execution from one place, not from tab sprawl.**

|        | Step               | Example                                                         |
| ------ | ------------------ | --------------------------------------------------------------- |
| **01** | Connect runtime    | Point Relay to your OpenClaw gateway and verify health.         |
| **02** | Run work           | Use Chat and Cowork to execute tasks with project context.      |
| **03** | Supervise outcomes | Review activity, memory, schedule, safety, and approvals.       |

<br/>

## Relay Is Right For You If

- You want a dedicated desktop operator app for AI workflows.
- You run OpenClaw in local, VPS, or custom environments.
- You need one control surface for chat, cowork, and workspace operations.
- You want human-in-the-loop controls for higher-risk actions.
- You want persistent preferences and repeatable operating workflows.

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>Desktop First</h3>
Electron shell with native desktop packaging and reliable local operation.
</td>
<td align="center" width="33%">
<h3>Chat + Cowork</h3>
Discussion and execution flows in one operator interface.
</td>
<td align="center" width="33%">
<h3>Project Context</h3>
Project-scoped tasks grounded in a selected working folder.
</td>
</tr>
<tr>
<td align="center">
<h3>Approval Controls</h3>
Safety scopes and approval requirements for sensitive actions.
</td>
<td align="center">
<h3>Workspace Visibility</h3>
Files, activity, memory, schedule, and safety views in one shell.
</td>
<td align="center">
<h3>Flexible Routing</h3>
Connect to local, VPS, or custom OpenClaw-compatible endpoints.
</td>
</tr>
</table>

<br/>

## Problems Relay Solves

| Without Relay | With Relay |
| --- | --- |
| You bounce between terminals, browser tabs, and config files to run AI work. | Relay centralizes execution, settings, and workspace oversight in one desktop surface. |
| Runtime setup is fragmented across environments. | Gateway URL/token setup and health checks are built directly into app flow. |
| Context drifts between tasks and folders. | Project-scoped cowork runs keep actions grounded in the intended workspace. |
| Risky actions happen without clear review boundaries. | Approval gates and safety scopes enforce human-in-the-loop control where needed. |

<br/>

## Why Relay Is Different

| | |
| --- | --- |
| **Runtime separation.** | OpenClaw handles backend execution while Relay focuses on operator control and visibility. |
| **Desktop reliability.** | Electron packaging and local persistence support real day-to-day operations. |
| **Human-in-the-loop by design.** | Approval workflows are first-class, not an afterthought. |
| **Context-aware execution.** | Projects and workspace views reduce drift and mistakes during execution. |

<br/>

## What Relay Is Not

| | |
| --- | --- |
| **Not a model provider.** | Relay does not train or host foundation models. |
| **Not the runtime itself.** | OpenClaw remains the execution/orchestration backend. |
| **Not a browser-only wrapper.** | Relay is a desktop operator interface. |
| **Not blind autopilot.** | Relay is built for governed operation and progressive trust. |

<br/>

## Quickstart

Requirements:

- Node.js 20+
- npm 10+

```bash
npm install
npm run dev
```

This starts Vite, compiles Electron in watch mode, and launches Relay.

Optional cloud auth setup:

```bash
cp .env.example .env
```

Set these when needed:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

<br/>

## Gateway Setup

In Settings -> Gateway:

1. Enter gateway URL and token.
2. Save.
3. Run health check.

Typical endpoint patterns:

- Local: `ws://127.0.0.1:18789`
- VPS: `wss://<your-host>`
- Custom: any OpenClaw-compatible endpoint

<br/>

## Development

```bash
npm run dev                 # Full desktop dev loop
npm run build               # Build renderer + electron
npm run preview             # Preview renderer build
npm run package             # Build and package app to release/
npm run lint                # ESLint
npm run typecheck           # TS type checks (renderer + electron)
npm run verify              # lint + typecheck + local actions smoke
npm run test:local-actions  # Local actions smoke tests
npm run test:e2e            # Electron E2E tests (mock gateway)
```

<br/>

## Open Source

- License: [MIT](LICENSE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security: [SECURITY.md](SECURITY.md)
- Support: [SUPPORT.md](SUPPORT.md)

<br/>

## Community

- Security contact: hello@seventeenlabs.io
- Use GitHub Issues for bugs and feature requests.
- Use pull requests for improvements and fixes.

<br/>

## License

MIT Copyright (c) 2026 SeventeenLabs