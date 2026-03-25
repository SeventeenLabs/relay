import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  HealthCheckResult,
  GatewayDiscoveryResult,
  LocalFileApplyResult,
  LocalFileAppendResult,
  LocalFileCreateResult,
  LocalFileDeleteResult,
  LocalFileExistsResult,
  LocalFileListResult,
  LocalFileReadResult,
  LocalFileRenameResult,
  LocalFileStatResult,
  LocalFilePlanAction,
  LocalFilePlanResult,
} from '../src/app-types.js';

const api = {
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config) as Promise<AppConfig>,
  healthCheck: (baseUrl: string) =>
    ipcRenderer.invoke('backend:health-check', baseUrl) as Promise<HealthCheckResult>,
  discoverGateway: () =>
    ipcRenderer.invoke('gateway:discover') as Promise<GatewayDiscoveryResult>,
  checkWorkspacePlugin: () =>
    ipcRenderer.invoke('plugin:check-workspace') as Promise<{ installed: boolean; error?: string }>,
  installWorkspacePlugin: () =>
    ipcRenderer.invoke('plugin:install-workspace') as Promise<{ ok: boolean; output?: string; error?: string }>,
  minimizeWindow: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke('window:close') as Promise<void>,
  showSystemMenu: (x: number, y: number) => ipcRenderer.invoke('window:show-system-menu', { x, y }) as Promise<void>,
  getDownloadsPath: () => ipcRenderer.invoke('local:downloads-path') as Promise<string>,
  selectFolder: (initialPath?: string) => ipcRenderer.invoke('local:select-folder', initialPath) as Promise<string | null>,
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
};

contextBridge.exposeInMainWorld('relay', api);
