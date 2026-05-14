import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  HealthCheckResult,
  LocalFileApplyResult,
  LocalFileAppendResult,
  LocalFileCreateResult,
  LocalFileDeleteResult,
  LocalFileExistsResult,
  LocalFileListResult,
  LocalFileReadResult,
  LocalFileRenameResult,
  LocalFileReplaceResult,
  LocalFileStatResult,
  LocalFilePlanAction,
  LocalFilePlanResult,
} from '../src/app-types.js';

const api = {
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config) as Promise<AppConfig>,
  healthCheck: (baseUrl: string) =>
    ipcRenderer.invoke('backend:health-check', baseUrl) as Promise<HealthCheckResult>,
  backendHttpRequest: (payload: { baseUrl: string; path: string; method?: string; token?: string; body?: string }) =>
    ipcRenderer.invoke('backend:http-request', payload) as Promise<{ ok: boolean; status: number; statusText: string; body: string }>,
  hermesModelOptions: (payload?: { gatewayUrl?: string }) =>
    ipcRenderer.invoke('hermes:model-options', payload) as Promise<{ providers: Array<{ slug: string; name: string; is_current?: boolean; models: string[] }>; model?: string; provider?: string }>,
  hermesSetMainModel: (payload: { gatewayUrl?: string; provider: string; model: string }) =>
    ipcRenderer.invoke('hermes:model-set-main', payload) as Promise<{ ok: boolean; provider: string; model: string; confirmedProvider?: string; confirmedModel?: string }>,
  hermesServiceStatus: () =>
    ipcRenderer.invoke('hermes:service-status') as Promise<{ gateway: boolean; apiServer: boolean; dashboard: boolean }>,
  hermesStartAllServices: () =>
    ipcRenderer.invoke('hermes:start-all-services') as Promise<{ ok: boolean; gateway: boolean; apiServer: boolean; dashboard: boolean; message?: string }>,
  acpConnect: (payload?: { gatewayUrl?: string; cwd?: string }) =>
    ipcRenderer.invoke('acp:connect', payload) as Promise<{ ok: boolean; sessionId: string }>,
  acpDisconnect: () =>
    ipcRenderer.invoke('acp:disconnect') as Promise<{ ok: boolean }>,
  acpCreateSession: (payload?: { cwd?: string }) =>
    ipcRenderer.invoke('acp:create-session', payload) as Promise<{ sessionId: string }>,
  acpPrompt: (payload: { sessionId: string; text: string }) =>
    ipcRenderer.invoke('acp:prompt', payload) as Promise<{ stopReason: string }>,
  acpListSessions: () =>
    ipcRenderer.invoke('acp:list-sessions') as Promise<Array<{ id: string; title?: string; cwd?: string }>>,
  acpListModels: (payload?: { sessionId?: string }) =>
    ipcRenderer.invoke('acp:list-models', payload) as Promise<{ models: Array<{ id: string; name: string }>; currentModelId: string | null }>,
  acpSetSessionModel: (payload: { sessionId: string; model: string }) =>
    ipcRenderer.invoke('acp:set-session-model', payload) as Promise<{ ok: boolean; message?: string }>,
  acpCancel: (payload: { sessionId: string }) =>
    ipcRenderer.invoke('acp:cancel', payload) as Promise<{ ok: boolean }>,
  acpWorkspaceList: (payload?: { path?: string }) =>
    ipcRenderer.invoke('acp:workspace-list', payload) as Promise<{ items?: Array<{ path?: string; kind?: string; size?: number; modifiedMs?: number }>; truncated?: boolean }>,
  acpWorkspaceRead: (payload: { path: string }) =>
    ipcRenderer.invoke('acp:workspace-read', payload) as Promise<{ content?: string }>,
  acpWorkspaceStat: (payload: { path: string }) =>
    ipcRenderer.invoke('acp:workspace-stat', payload) as Promise<{ kind?: string; size?: number; createdMs?: number; modifiedMs?: number }>,
  acpWorkspaceRename: (payload: { oldPath: string; newPath: string }) =>
    ipcRenderer.invoke('acp:workspace-rename', payload) as Promise<{ ok?: boolean }>,
  acpWorkspaceDelete: (payload: { path: string }) =>
    ipcRenderer.invoke('acp:workspace-delete', payload) as Promise<{ ok?: boolean }>,
  acpWorkspaceWrite: (payload: { path: string; content: string }) =>
    ipcRenderer.invoke('acp:workspace-write', payload) as Promise<{ ok?: boolean }>,
  onAcpEvent: (handler: (event: { sessionId: string; update: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; update: unknown }) => {
      handler(payload);
    };
    ipcRenderer.on('acp:event', listener);
    return () => {
      ipcRenderer.removeListener('acp:event', listener);
    };
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke('window:close') as Promise<void>,
  showSystemMenu: (x: number, y: number) => ipcRenderer.invoke('window:show-system-menu', { x, y }) as Promise<void>,
  getDownloadsPath: () => ipcRenderer.invoke('local:downloads-path') as Promise<string>,
  selectFolder: (initialPath?: string) => ipcRenderer.invoke('local:select-folder', initialPath) as Promise<string | null>,
  selectFile: (initialPath?: string) => ipcRenderer.invoke('local:select-file', initialPath) as Promise<string | null>,
  selectContextPaths: (initialPath?: string) =>
    ipcRenderer.invoke('local:select-context-paths', initialPath) as Promise<Array<{ path: string; kind: 'file' | 'directory' }>>,
  planOrganizeFolder: (rootPath: string) =>
    ipcRenderer.invoke('local:plan-organize-folder', rootPath) as Promise<LocalFilePlanResult>,
  applyOrganizeFolderPlan: (rootPath: string, actions: LocalFilePlanAction[]) =>
    ipcRenderer.invoke('local:apply-organize-folder-plan', {
      rootPath,
      actions,
    }) as Promise<LocalFileApplyResult>,
  createFileInFolder: (rootPath: string, relativePath: string, content: string, overwrite?: boolean) =>
    ipcRenderer.invoke('local:create-file-in-folder', {
      rootPath,
      relativePath,
      content,
      overwrite,
    }) as Promise<LocalFileCreateResult>,
  appendFileInFolder: (rootPath: string, relativePath: string, content: string) =>
    ipcRenderer.invoke('local:append-file-in-folder', {
      rootPath,
      relativePath,
      content,
    }) as Promise<LocalFileAppendResult>,
  replaceInFile: (rootPath: string, relativePath: string, oldString: string, newString: string, replaceAll?: boolean) =>
    ipcRenderer.invoke('local:replace-in-file', {
      rootPath,
      relativePath,
      oldString,
      newString,
      replaceAll,
    }) as Promise<LocalFileReplaceResult>,
  readFileInFolder: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('local:read-file-in-folder', {
      rootPath,
      relativePath,
    }) as Promise<LocalFileReadResult>,
  listDirInFolder: (rootPath: string, relativePath?: string) =>
    ipcRenderer.invoke('local:list-dir-in-folder', {
      rootPath,
      relativePath,
    }) as Promise<LocalFileListResult>,
  existsInFolder: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('local:exists-in-folder', {
      rootPath,
      relativePath,
    }) as Promise<LocalFileExistsResult>,
  renameInFolder: (rootPath: string, oldRelative: string, newRelative: string) =>
    ipcRenderer.invoke('local:rename-in-folder', {
      rootPath,
      oldRelative,
      newRelative,
    }) as Promise<LocalFileRenameResult>,
  deleteInFolder: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('local:delete-in-folder', {
      rootPath,
      relativePath,
    }) as Promise<LocalFileDeleteResult>,
  statInFolder: (rootPath: string, relativePath: string) =>
    ipcRenderer.invoke('local:stat-in-folder', {
      rootPath,
      relativePath,
    }) as Promise<LocalFileStatResult>,
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('local:open-path', {
      targetPath,
    }) as Promise<{ ok: boolean; error?: string }>,
  shellExec: (rootPath: string, command: string, timeoutMs?: number) =>
    ipcRenderer.invoke('local:shell-exec', {
      rootPath,
      command,
      timeoutMs,
    }) as Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>,
  webFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) =>
    ipcRenderer.invoke('local:web-fetch', {
      url,
      options,
    }) as Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; truncated: boolean }>,
  notify: (title: string, body?: string) =>
    ipcRenderer.invoke('notify', { title, body }) as Promise<{ ok: boolean; message?: string }>,
};

contextBridge.exposeInMainWorld('relay', api);
