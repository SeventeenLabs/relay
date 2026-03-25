/**
 * OpenClaw Plugin: Relay Workspace
 *
 * Registers workspace.* Gateway RPC methods so the Relay desktop app can
 * browse, read, write, rename, and delete files in the agent's workspace
 * over the WebSocket protocol.
 */

import { definePluginEntry } from "/usr/lib/node_modules/openclaw/dist/plugin-sdk/plugin-entry.js";
import { readdir, readFile, writeFile, stat, rename, rm, mkdir } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";

const DEFAULT_MAX_LIST_ITEMS = 200;
const DEFAULT_MAX_READ_BYTES = 256 * 1024; // 256 KB

const BLOCKED_NAMES = new Set([
  "desktop.ini",
  "thumbs.db",
  ".ds_store",
]);

function isHidden(name: string): boolean {
  return name.startsWith(".") || BLOCKED_NAMES.has(name.toLowerCase());
}

function assertPathInside(child: string, parent: string): void {
  const rel = relative(parent, child);
  if (rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\")) {
    throw new Error("Path outside workspace boundary");
  }
  const segments = rel.split(/[\\/]/);
  for (const seg of segments) {
    if (seg && isHidden(seg)) {
      throw new Error("Hidden path access denied");
    }
  }
}

function safePath(workspaceRoot: string, relPath: string): string {
  const cleaned = (relPath || "").replace(/\\/g, "/");
  const resolved = resolve(workspaceRoot, cleaned);
  assertPathInside(resolved, workspaceRoot);
  return resolved;
}

export default definePluginEntry({
  id: "relay-workspace",
  name: "Relay Workspace",
  description: "Exposes workspace.* Gateway RPC methods for Relay file browsing",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      maxListItems: {
        type: "number",
        description: "Maximum items returned by workspace.list (default: 200)"
      },
      maxReadBytes: {
        type: "number",
        description: "Maximum file size for workspace.read in bytes (default: 262144 = 256 KB)"
      }
    }
  },

  register(api: any) {
    try {
      const cfg = api.config;
      const pluginCfg = (api.pluginConfig as any) || {};

      const maxListItems = pluginCfg.maxListItems ?? DEFAULT_MAX_LIST_ITEMS;
      const maxReadBytes = pluginCfg.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
      const workspaceRoot = api.runtime.agent.resolveAgentWorkspaceDir(cfg);

      api.logger.info(`Relay Workspace plugin registered — workspace: ${workspaceRoot}`);

      // workspace.list — list directory contents
      api.registerGatewayMethod("workspace.list", async ({ params, respond }: any) => {
        try {
          const p = (params as { path?: string })?.path ?? "";
          const absPath = safePath(workspaceRoot, p);

          let entries;
          try {
            entries = await readdir(absPath, { withFileTypes: true });
          } catch (err: any) {
            if (err?.code === "ENOENT") {
              respond(false, { error: `Directory not found: ${p}` });
              return;
            }
            if (err?.code === "ENOTDIR") {
              respond(false, { error: `Not a directory: ${p}` });
              return;
            }
            respond(false, { error: err.message });
            return;
          }

          const items: Array<{
            path: string;
            kind: "file" | "directory";
            size: number;
            modifiedMs: number;
          }> = [];

          for (const entry of entries) {
            if (isHidden(entry.name)) continue;
            if (items.length >= maxListItems) break;

            const entryPath = join(absPath, entry.name);
            try {
              const st = await stat(entryPath);
              items.push({
                path: entry.name,
                kind: entry.isDirectory() ? "directory" : "file",
                size: entry.isFile() ? st.size : 0,
                modifiedMs: st.mtimeMs,
              });
            } catch {
              // Skip entries we can't stat
            }
          }

          respond(true, {
            items,
            truncated: entries.filter((e) => !isHidden(e.name)).length > maxListItems,
          });
        } catch (err: any) {
          api.logger.error(`workspace.list error: ${err.message}`);
          respond(false, { error: err.message });
        }
      });

      // workspace.read — read a file
      api.registerGatewayMethod("workspace.read", async ({ params, respond }: any) => {
        try {
          const p = (params as { path?: string })?.path;
          if (!p) {
            respond(false, { error: "Missing required parameter: path" });
            return;
          }

          const absPath = safePath(workspaceRoot, p);

          let st;
          try {
            st = await stat(absPath);
          } catch (err: any) {
            if (err?.code === "ENOENT") {
              respond(false, { error: `File not found: ${p}` });
              return;
            }
            respond(false, { error: err.message });
            return;
          }

          if (st.size > maxReadBytes) {
            respond(false, { error: `File too large: ${st.size} > ${maxReadBytes} bytes` });
            return;
          }

          try {
            const content = await readFile(absPath, "utf-8");
            respond(true, { content, size: st.size });
          } catch (err: any) {
            if (err?.code === "EISDIR") {
              respond(false, { error: `Path is a directory: ${p}` });
              return;
            }
            respond(false, { error: err.message });
          }
        } catch (err: any) {
          api.logger.error(`workspace.read error: ${err.message}`);
          respond(false, { error: err.message });
        }
      });

      // workspace.write — create or overwrite a file
      api.registerGatewayMethod("workspace.write", async ({ params, respond }: any) => {
        try {
          const p = (params as any)?.path;
          const content = (params as any)?.content;

          if (!p) {
            respond(false, { error: "Missing required parameter: path" });
            return;
          }
          if (typeof content !== "string") {
            respond(false, { error: "Missing or invalid parameter: content" });
            return;
          }

          const absPath = safePath(workspaceRoot, p);

          // Create parent directory if needed
          const parentDir = dirname(absPath);
          try {
            await mkdir(parentDir, { recursive: true });
          } catch (err: any) {
            if (err?.code !== "EEXIST") {
              respond(false, { error: err.message });
              return;
            }
          }

          await writeFile(absPath, content, "utf-8");
          respond(true, { path: p, size: content.length });
        } catch (err: any) {
          api.logger.error(`workspace.write error: ${err.message}`);
          respond(false, { error: err.message });
        }
      });

      // workspace.delete — delete a file or directory
      api.registerGatewayMethod("workspace.delete", async ({ params, respond }: any) => {
        try {
          const p = (params as any)?.path;
          if (!p) {
            respond(false, { error: "Missing required parameter: path" });
            return;
          }

          const absPath = safePath(workspaceRoot, p);

          try {
            await rm(absPath, { recursive: true, force: true });
            respond(true, { path: p, deleted: true });
          } catch (err: any) {
            if (err?.code === "ENOENT") {
              respond(false, { error: `Path not found: ${p}` });
              return;
            }
            respond(false, { error: err.message });
          }
        } catch (err: any) {
          api.logger.error(`workspace.delete error: ${err.message}`);
          respond(false, { error: err.message });
        }
      });

      api.logger.info("Relay Workspace plugin ready");
    } catch (err) {
      api.logger.error(`Relay Workspace plugin registration failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
});
