<p align="center">
	<img src="branding/relay-logo-gateway.svg" alt="Relay" width="680" />
</p>

<p align="center">
	<a href="#quickstart"><strong>Quickstart</strong></a>
	&middot;
	<a href="docs/product-strategy.md"><strong>Strategy</strong></a>
	&middot;
	<a href="docs/RELAY-MVP-DEFINITION.md"><strong>MVP</strong></a>
	&middot;
	<a href="docs/WORKSPACE-RPC-SPEC.md"><strong>RPC Spec</strong></a>
</p>

<p align="center">
	<img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
	<img src="https://img.shields.io/badge/desktop-Electron-47848f" alt="Electron" />
	<img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-646cff" alt="React and Vite" />
	<img src="https://img.shields.io/badge/language-TypeScript-3178c6" alt="TypeScript" />
</p>

<br/>

## What is Relay?

# Open-source cowork interface for OpenClaw operators

**If OpenClaw is the runtime, Relay is the operating desk.**

Relay is an Electron desktop app for running AI work with human oversight.
It combines chat, cowork execution, workspace context, and operator settings in one interface.

You can run Relay against local, VPS, or custom OpenClaw endpoints.

**Manage execution from one place, not from tab sprawl.**

|        | Step               | Example                                                         |
| ------ | ------------------ | --------------------------------------------------------------- |
| **01** | Connect runtime    | Point Relay to your OpenClaw gateway and verify health.         |
| **02** | Run work           | Use Chat and Cowork to execute tasks with context and controls. |
| **03** | Supervise outcomes | Track activity, memory, schedule, safety, and settings.         |

<br/>

## Relay is right for you if

- You want a dedicated desktop operator app for AI workflows.
- You run OpenClaw in local, VPS, or custom environments.
- You need one control surface for chat, cowork, and workspace operations.
- You want a human-in-the-loop interface with safety and governance pages.
- You want configurable appearance, language, and system prompt preferences.

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>Desktop First</h3>
Electron shell with native window controls, preload bridge, and packaged builds.
</td>
<td align="center" width="33%">
<h3>Chat + Cowork</h3>
Claude-style interaction for discussion and execution-oriented task flows.
</td>
<td align="center" width="33%">
<h3>Endpoint Routing</h3>
Connect to local, VPS, or custom OpenClaw gateway targets.
</td>
</tr>
<tr>
<td align="center">
<h3>Workspace Surface</h3>
Files, Activity, Memory, Scheduled, and Safety pages in one app shell.
</td>
<td align="center">
<h3>Operator Controls</h3>
Profile, appearance, language, system prompt, gateway, privacy, and developer settings.
</td>
<td align="center">
<h3>Persistent Preferences</h3>
Theme/style/language and user settings persisted locally for consistent operation.
</td>
</tr>
</table>

<br/>

## Problems Relay solves

| Without Relay | With Relay |
| --- | --- |
| You bounce between terminals, browser tabs, and config files to run daily AI work. | Relay centralizes chat, cowork, settings, and workspace operations in one desktop surface. |
| Runtime endpoint setup is fragmented and brittle across environments. | Gateway configuration, token entry, and health checks are built into the app flow. |
| Operator context gets scattered between ad hoc notes and disconnected UIs. | Files, activity, memory, scheduled work, and safety are available in one consistent shell. |
| Personal operating preferences get reset or lost between sessions. | Theme, style, language, and profile settings are persisted locally. |

<br/>

## Why Relay is different

Relay is intentionally the user-facing layer, not the orchestration runtime.

| | |
| --- | --- |
| **Runtime separation.** | OpenClaw handles backend execution; Relay handles operator UX and supervision. |
| **Desktop reliability.** | Electron shell + preload bridge provide a stable local operator environment. |
| **Human-in-the-loop UX.** | Designed for guided execution and review, not blind autonomy. |
| **Configurable operation.** | Works across local, VPS, and custom endpoint topologies. |
| **Workspace-aware surface.** | Operational pages keep context visible while executing work. |

<br/>

## What Relay is not

| | |
| --- | --- |
| **Not a base model provider.** | Relay does not train or host foundation models. |
| **Not the backend runtime.** | OpenClaw remains the execution/orchestration layer. |
| **Not a browser-only wrapper.** | Relay is built as a desktop operating interface. |
| **Not a no-governance autopilot.** | The UX is built for supervision, controls, and progressive trust. |

<br/>

## Quickstart

Requirements:

- Node.js 20+
- npm 10+

Install and run:

```bash
npm install
npm run dev
```

This starts Vite, compiles Electron in watch mode, and launches the desktop app.

Optional Supabase setup for cloud mode:

```bash
cp .env.example .env
```

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

You can skip this if you only use local mode.

<br/>

## Configure Gateway

In **Settings -> Gateway**:

1. Enter gateway URL and token.
2. Save and run health check.
3. Confirm status before daily operation.

Typical endpoint patterns:

- Local: `ws://127.0.0.1:18789`
- VPS: your secure remote gateway URL
- Custom: any OpenClaw-compatible endpoint

<br/>

## Development

```bash
npm run dev                # Full desktop dev loop
npm run build              # Build renderer + electron
npm run preview            # Preview renderer build
npm run package            # Create packaged app in release/
npm run test:local-actions # Smoke test local actions
```

<br/>

## Docs

- [Product strategy](docs/product-strategy.md)
- [MVP definition](docs/RELAY-MVP-DEFINITION.md)
- [MVP v1 features](docs/RELAY-MVP-V1-FEATURES.md)
- [Workspace RPC spec](docs/WORKSPACE-RPC-SPEC.md)

<br/>

## Roadmap

- Improve cowork execution depth and operator feedback loops
- Expand workspace automation and scheduling workflows
- Strengthen safety and governance UX patterns
- Improve onboarding for OpenClaw endpoint setup
- Continue polishing Relay style and desktop ergonomics

<br/>

## License

MIT