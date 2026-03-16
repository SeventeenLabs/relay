import type { AppConfig, HealthCheckResult } from './app-types';

type OpenClawCoworkApi = {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  healthCheck: (baseUrl: string) => Promise<HealthCheckResult>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
};

declare global {
  interface Window {
    openClawCowork?: OpenClawCoworkApi;
  }
}

export {};