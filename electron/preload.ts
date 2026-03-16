import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, HealthCheckResult } from '../src/app-types.js';

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
};

contextBridge.exposeInMainWorld('openClawCowork', api);