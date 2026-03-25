import type { ConnectorDefinition, ConnectorActionResult, ConnectorExecutionContext } from './connector-types';

export function createFilesystemConnector(): ConnectorDefinition {
  return {
    id: 'filesystem',
    name: 'File System',
    description: 'Read, write, and manage files in the working folder.',
    icon: 'folder',
    status: 'active',
    config: {},
    actions: [
      {
        id: 'filesystem.read_file',
        name: 'Read file',
        description: 'Read the contents of a file',
        scopeId: 'file-read',
        riskLevel: 'low',
        params: [{ name: 'path', description: 'Relative file path', required: true, type: 'string' }],
      },
      {
        id: 'filesystem.create_file',
        name: 'Create file',
        description: 'Create a new file with content',
        scopeId: 'file-create',
        riskLevel: 'medium',
        params: [
          { name: 'path', description: 'Relative file path', required: true, type: 'string' },
          { name: 'content', description: 'File content', required: true, type: 'string' },
          { name: 'overwrite', description: 'Overwrite if exists', required: false, type: 'boolean' },
        ],
      },
      {
        id: 'filesystem.append_file',
        name: 'Append to file',
        description: 'Append content to an existing file',
        scopeId: 'file-modify',
        riskLevel: 'medium',
        params: [
          { name: 'path', description: 'Relative file path', required: true, type: 'string' },
          { name: 'content', description: 'Content to append', required: true, type: 'string' },
        ],
      },
      {
        id: 'filesystem.list_dir',
        name: 'List directory',
        description: 'List files and directories',
        scopeId: 'file-list',
        riskLevel: 'low',
        params: [{ name: 'path', description: 'Relative directory path', required: false, type: 'string' }],
      },
      {
        id: 'filesystem.exists',
        name: 'Check existence',
        description: 'Check if a file or directory exists',
        scopeId: 'file-read',
        riskLevel: 'low',
        params: [{ name: 'path', description: 'Relative path', required: true, type: 'string' }],
      },
      {
        id: 'filesystem.rename',
        name: 'Rename / move',
        description: 'Rename or move a file',
        scopeId: 'file-move',
        riskLevel: 'medium',
        params: [
          { name: 'path', description: 'Current relative path', required: true, type: 'string' },
          { name: 'newPath', description: 'New relative path', required: true, type: 'string' },
        ],
      },
      {
        id: 'filesystem.delete',
        name: 'Delete',
        description: 'Delete a file permanently',
        scopeId: 'file-delete',
        riskLevel: 'high',
        params: [{ name: 'path', description: 'Relative path', required: true, type: 'string' }],
      },
      {
        id: 'filesystem.stat',
        name: 'File info',
        description: 'Get file metadata (size, dates)',
        scopeId: 'file-read',
        riskLevel: 'low',
        params: [{ name: 'path', description: 'Relative path', required: true, type: 'string' }],
      },
    ],
    test: async () => ({ ok: true, message: 'File system connector is always available locally.' }),
    execute: async (actionId: string, params: Record<string, unknown>, ctx: ConnectorExecutionContext): Promise<ConnectorActionResult> => {
      const { rootPath, bridge } = ctx;
      const path = typeof params.path === 'string' ? params.path : '';

      switch (actionId) {
        case 'filesystem.read_file': {
          if (!bridge.readFileInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'read_file bridge unavailable' };
          const result = await bridge.readFileInFolder(rootPath, path);
          return { ok: true, data: result };
        }
        case 'filesystem.create_file': {
          if (!bridge.createFileInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'create_file bridge unavailable' };
          const content = typeof params.content === 'string' ? params.content : '';
          const overwrite = typeof params.overwrite === 'boolean' ? params.overwrite : false;
          const result = await bridge.createFileInFolder(rootPath, path, content, overwrite);
          return { ok: true, data: result };
        }
        case 'filesystem.append_file': {
          if (!bridge.appendFileInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'append_file bridge unavailable' };
          const content = typeof params.content === 'string' ? params.content : '';
          const result = await bridge.appendFileInFolder(rootPath, path, content);
          return { ok: true, data: result };
        }
        case 'filesystem.list_dir': {
          if (!bridge.listDirInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'list_dir bridge unavailable' };
          const result = await bridge.listDirInFolder(rootPath, path || undefined);
          return { ok: true, data: result };
        }
        case 'filesystem.exists': {
          if (!bridge.existsInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'exists bridge unavailable' };
          const result = await bridge.existsInFolder(rootPath, path);
          return { ok: true, data: result };
        }
        case 'filesystem.rename': {
          if (!bridge.renameInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'rename bridge unavailable' };
          const newPath = typeof params.newPath === 'string' ? params.newPath : '';
          const result = await bridge.renameInFolder(rootPath, path, newPath);
          return { ok: true, data: result };
        }
        case 'filesystem.delete': {
          if (!bridge.deleteInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'delete bridge unavailable' };
          const result = await bridge.deleteInFolder(rootPath, path);
          return { ok: true, data: result };
        }
        case 'filesystem.stat': {
          if (!bridge.statInFolder) return { ok: false, errorCode: 'UNAVAILABLE', message: 'stat bridge unavailable' };
          const result = await bridge.statInFolder(rootPath, path);
          return { ok: true, data: result };
        }
        default:
          return { ok: false, errorCode: 'UNKNOWN_ACTION', message: `Unknown action: ${actionId}` };
      }
    },
  };
}
