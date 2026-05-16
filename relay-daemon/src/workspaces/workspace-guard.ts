import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export class WorkspaceGuard {
  constructor(private readonly workspaceMap: Record<string, string>) {}

  list() {
    return Object.entries(this.workspaceMap).map(([key, value]) => ({ key, path: value }));
  }

  async resolveWorkspacePath(workspaceKey: string): Promise<string> {
    const configured = this.workspaceMap[workspaceKey];
    if (!configured) {
      throw new Error(`workspace_not_found:${workspaceKey}`);
    }

    const resolved = await fs.realpath(configured).catch(() => null);
    if (!resolved) {
      throw new Error(`workspace_missing:${workspaceKey}`);
    }

    const normalized = path.normalize(resolved);
    return normalized;
  }
}
