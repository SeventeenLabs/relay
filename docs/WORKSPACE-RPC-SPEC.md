# OpenClaw Gateway — `workspace.*` RPC Specification

> Required server-side implementation for Relay's remote file explorer.

## Architecture Context (from OpenClaw docs research)

**Current state (as of OpenClaw docs, 2026):** The OpenClaw gateway protocol does
NOT expose any direct file access RPCs for operator clients. The documented RPC
surface includes: `chat.send`, `sessions.*`, `models.list`, `tools.catalog`,
`cron.list`, `exec.approval.resolve`, and device/presence management.

### How OpenClaw handles files today

1. **Agent file tools** (`group:fs`): `read`, `write`, `edit`, `apply_patch` —
   these are tools the AI model uses *during chat responses*. They operate on the
   agent's workspace directory. An operator client cannot invoke them directly.

2. **`tools.catalog` RPC** (`operator.read` scope): Returns the runtime tool
   catalog — a discovery endpoint listing available tools with group, source, and
   provenance metadata. Does not invoke tools.

3. **Workspace location**: Configured per-agent at `agents.defaults.workspace`
   (default: `~/.openclaw/workspace`). With sandboxing enabled, `workspaceAccess`
   controls visibility: `"none"` (sandbox only), `"ro"` (read-only mount at
   `/agent`), `"rw"` (read/write mount at `/workspace`).

4. **Sandbox backends**: Docker (local), SSH (remote), OpenShell (managed remote).
   The SSH backend runs `exec`, `read`, `write`, `edit`, `apply_patch` directly
   against the remote workspace over SSH.

### Solution: `relay-workspace` plugin

The OpenClaw Plugin SDK provides `api.registerGatewayMethod(name, handler)` which
lets plugins add custom Gateway RPC methods. The **`relay-workspace`** plugin
(located at `plugins/openclaw-relay-workspace/`) uses this API to register all 6
`workspace.*` methods on the gateway, making Relay's remote file explorer work.

Plugin entry point: `plugins/openclaw-relay-workspace/index.ts`

**How it works:**

1. Plugin loads and resolves the agent workspace directory via
   `api.runtime.agent.resolveAgentWorkspaceDir(cfg)`
2. Registers 6 gateway methods: `workspace.list`, `workspace.read`,
   `workspace.write`, `workspace.stat`, `workspace.rename`, `workspace.delete`
3. Relay connects and calls these methods through its existing gateway client
4. Path security enforced: directory traversal blocked, hidden files filtered,
   file size limits applied

### Relay's approach for remote file access

| Layer | Strategy |
|-------|----------|
| `relay-workspace` plugin | Registers `workspace.*` Gateway RPC methods on OpenClaw server |
| Gateway client | Calls `workspace.*` RPCs over WebSocket JSON-RPC |
| `tools.catalog` | Discover agent capabilities (group:fs tools) for fallback |
| `FileService` | Abstraction layer — auto-selects local IPC or remote RPC |
| Fallback UI | Shows agent tool capabilities when plugin not installed |
| Local mode | Full file explorer via Electron IPC bridge (always works) |

---

## Overview

When Relay connects to a **remote** OpenClaw gateway (non-localhost), the file explorer
routes all file operations through `workspace.*` RPC methods instead of local Electron IPC.
The server must implement these 6 methods to enable remote workspace browsing.

## Multi-Agent Requirement

In multi-agent OpenClaw deployments, `workspace.*` methods should resolve against the
workspace of the agent assigned to the active run/session, not against a global path.

Recommended behavior:

1. Resolve `agentId` from authenticated session context or explicit request context.
2. Resolve workspace root from that agent profile.
3. Apply all path normalization and boundary checks within that agent-scoped root.
4. Include agent attribution in audit events for `workspace.write`, `workspace.rename`, and `workspace.delete`.

If no agent can be resolved, return a deterministic authorization or context error instead
of falling back to a shared root.

## Protocol

All methods use the existing JSON-RPC v3 frame format:

```
→ Client sends:
{
  "type": "req",
  "id": "req-{timestamp}-{counter}",
  "method": "workspace.list",
  "params": { ... }
}

← Server responds:
{
  "type": "res",
  "id": "<matching request id>",
  "ok": true,
  "payload": { ... }
}
```

**Error response** (for unknown method, permission denied, etc.):
```json
{
  "type": "res",
  "id": "<matching request id>",
  "ok": false,
  "error": {
    "code": "METHOD_NOT_FOUND",
    "message": "unknown method: workspace.list"
  }
}
```

---

## Methods

### `workspace.list`

List files and directories at a relative path within the agent's workspace.

**Params:**
```json
{
  "path": ""           // Relative path from workspace root ("" = root)
}
```

**Payload:**
```json
{
  "items": [
    {
      "path": "src",                  // Relative name (not full path)
      "kind": "directory",            // "file" | "directory"
      "size": 0,                      // Bytes (optional, 0 for dirs)
      "modifiedMs": 1711200000000     // mtime in ms since epoch (optional)
    },
    {
      "path": "package.json",
      "kind": "file",
      "size": 1842,
      "modifiedMs": 1711200000000
    }
  ],
  "truncated": false                  // true if list was capped
}
```

**Security rules:**
- Max 200 items per response
- Exclude hidden files/directories (names starting with `.`)
- Exclude OS metadata (`desktop.ini`, `thumbs.db`)
- Path must resolve inside the workspace root (no `..` traversal)

---

### `workspace.read`

Read the contents of a file.

**Params:**
```json
{
  "path": "src/main.ts"              // Relative path from workspace root
}
```

**Payload:**
```json
{
  "content": "import { app } from 'electron';\n..."
}
```

**Security rules:**
- Max file size: 256 KB (reject larger files with an error)
- Must be a file, not a directory
- Path must resolve inside workspace root
- Return UTF-8 encoded content

---

### `workspace.write`

Create or overwrite a file. Creates parent directories as needed.

**Params:**
```json
{
  "path": "src/new-file.ts",
  "content": "export const x = 1;\n"
}
```

**Payload:**
```json
{
  "path": "src/new-file.ts",
  "created": true
}
```

**Security rules:**
- Path must resolve inside workspace root
- Do not allow writing to hidden paths
- Create intermediate directories if missing

---

### `workspace.stat`

Get metadata for a file or directory.

**Params:**
```json
{
  "path": "src/main.ts"
}
```

**Payload:**
```json
{
  "kind": "file",                     // "file" | "directory"
  "size": 4096,                       // Bytes
  "createdMs": 1711100000000,         // Birth time (ms since epoch)
  "modifiedMs": 1711200000000         // Modification time (ms since epoch)
}
```

---

### `workspace.rename`

Rename or move a file/directory within the workspace.

**Params:**
```json
{
  "oldPath": "src/old-name.ts",
  "newPath": "src/new-name.ts"
}
```

**Payload:**
```json
{
  "oldPath": "src/old-name.ts",
  "newPath": "src/new-name.ts",
  "renamed": true
}
```

**Security rules:**
- Both paths must resolve inside workspace root
- Create intermediate directories for `newPath` if needed
- Reject if `newPath` already exists

---

### `workspace.delete`

Delete a file or directory (recursive for directories).

**Params:**
```json
{
  "path": "src/temp-file.ts"
}
```

**Payload:**
```json
{
  "path": "src/temp-file.ts",
  "deleted": true
}
```

**Security rules:**
- Path must resolve inside workspace root
- Use `{ recursive: true, force: true }` for directories
- Do not allow deleting the workspace root itself

---

## Scope Requirements

These methods should be gated behind `operator.read` (for `list`, `read`, `stat`) and
`operator.write` (for `write`, `rename`, `delete`) scopes.

If the connected device does not have the required scope, respond with:
```json
{
  "type": "res",
  "id": "...",
  "ok": false,
  "error": {
    "code": "SCOPE_DENIED",
    "message": "Insufficient permissions for workspace.write"
  }
}
```

---

## Reference Implementation (Node.js pseudocode)

```typescript
import { readdir, readFile, writeFile, stat, rename, rm, mkdir } from 'fs/promises';
import { join, resolve, relative } from 'path';

const WORKSPACE_ROOT = '/path/to/agent/workspace';
const MAX_LIST_ITEMS = 200;
const MAX_READ_SIZE = 256 * 1024; // 256 KB
const BLOCKED_NAMES = new Set(['desktop.ini', 'thumbs.db']);

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith('..') && !rel.startsWith('/');
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || BLOCKED_NAMES.has(name.toLowerCase());
}

function safePath(relPath: string): string {
  const resolved = resolve(WORKSPACE_ROOT, relPath);
  if (!isPathInside(resolved, WORKSPACE_ROOT)) {
    throw new Error('Path outside workspace boundary');
  }
  // Check no hidden segments
  const segments = relative(WORKSPACE_ROOT, resolved).split(/[\\/]/);
  if (segments.some(isHidden)) {
    throw new Error('Hidden path access denied');
  }
  return resolved;
}

// Register these as RPC method handlers:

handlers['workspace.list'] = async ({ path: relPath = '' }) => {
  const absPath = safePath(relPath);
  const entries = await readdir(absPath, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    if (items.length >= MAX_LIST_ITEMS) break;
    const entryPath = join(absPath, entry.name);
    const st = await stat(entryPath);
    items.push({
      path: entry.name,
      kind: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isFile() ? st.size : 0,
      modifiedMs: st.mtimeMs,
    });
  }
  return { items, truncated: entries.length > MAX_LIST_ITEMS };
};

handlers['workspace.read'] = async ({ path: relPath }) => {
  const absPath = safePath(relPath);
  const st = await stat(absPath);
  if (st.size > MAX_READ_SIZE) throw new Error('File too large');
  const content = await readFile(absPath, 'utf-8');
  return { content };
};

handlers['workspace.write'] = async ({ path: relPath, content }) => {
  const absPath = safePath(relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf-8');
  return { path: relPath, created: true };
};

handlers['workspace.stat'] = async ({ path: relPath }) => {
  const absPath = safePath(relPath);
  const st = await stat(absPath);
  return {
    kind: st.isDirectory() ? 'directory' : 'file',
    size: st.size,
    createdMs: st.birthtimeMs,
    modifiedMs: st.mtimeMs,
  };
};

handlers['workspace.rename'] = async ({ oldPath, newPath }) => {
  const absOld = safePath(oldPath);
  const absNew = safePath(newPath);
  await mkdir(dirname(absNew), { recursive: true });
  await rename(absOld, absNew);
  return { oldPath, newPath, renamed: true };
};

handlers['workspace.delete'] = async ({ path: relPath }) => {
  const absPath = safePath(relPath);
  await rm(absPath, { recursive: true, force: true });
  return { path: relPath, deleted: true };
};
```

---

## Relay-Side Status

| Component | Status |
|-----------|--------|
| Gateway client RPC methods (`workspace.*`) | ✅ Implemented |
| `tools.catalog` RPC integration | ✅ Implemented |
| `FileService` abstraction (local/remote routing) | ✅ Implemented |
| `files-page.tsx` dual-path rendering | ✅ Implemented |
| Graceful fallback with tool catalog display | ✅ Implemented |
| **OpenClaw `relay-workspace` plugin** | ✅ **Implemented** (`plugins/openclaw-relay-workspace/`) |
