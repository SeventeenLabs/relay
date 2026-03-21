import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  HealthCheckResult,
  LocalFileApplyResult,
  LocalFilePlanAction,
  LocalFilePlanResult,
} from '../src/app-types.js';

const api = {
  getConfig: () => ipcRenderer.invoke('config:get') as Promise<AppConfig>,
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config) as Promise<AppConfig>,
  healthCheck: (baseUrl: string) =>
    ipcRenderer.invoke('backend:health-check', baseUrl) as Promise<HealthCheckResult>,
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
};

contextBridge.exposeInMainWorld('relay', api);