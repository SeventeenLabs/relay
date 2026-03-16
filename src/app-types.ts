export type BackendMode = 'local' | 'vps' | 'custom';

export type AppConfig = {
  mode: BackendMode;
  baseUrl: string;
};

export type HealthCheckResult = {
  ok: boolean;
  status?: number;
  message: string;
};