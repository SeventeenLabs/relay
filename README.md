# OpenClawCowork

OpenClawCowork is an Electron desktop shell for a Claude-style coworking experience backed by your own OpenClaw deployment. The scaffold includes a React renderer, Electron IPC bridge, local config persistence, and backend health checks for local or VPS-hosted OpenClaw instances.

## Stack

- Electron for the desktop shell
- React + Vite + TypeScript for the renderer
- Electron preload bridge for safe IPC access
- Persisted backend settings stored in Electron user data

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app in development mode:

   ```bash
   npm run dev
   ```

3. In the settings panel, choose one of these backend modes:

- `local`: defaults to `http://127.0.0.1:3000`
- `vps`: placeholder HTTPS URL for a remote OpenClaw deployment
- `custom`: any compatible OpenClaw base URL

4. Run the built-in health check to confirm the backend is reachable.

## Build

```bash
npm run build
```

To package the desktop app:

```bash
npm run package
```

## Next integration step

The current scaffold intentionally stops at backend configuration and connectivity testing. To complete the cowork flow, add a new Electron IPC method that proxies chat/session requests from the renderer to the OpenClaw API you want to target.

Suggested next additions:

- session creation and chat streaming IPC
- workspace/file context syncing
- authentication or API key storage for remote OpenClaw deployments
- conversation history persistence