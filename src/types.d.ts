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
} from './app-types';

type RelayApi = {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  healthCheck: (baseUrl: string) => Promise<HealthCheckResult>;
  backendHttpRequest: (payload: { baseUrl: string; path: string; method?: string; token?: string; body?: string }) => Promise<{ ok: boolean; status: number; statusText: string; body: string }>;
  hermesModelOptions: (payload?: { gatewayUrl?: string }) => Promise<{ providers: Array<{ slug: string; name: string; is_current?: boolean; models: string[] }>; model?: string; provider?: string }>;
  hermesSetMainModel: (payload: { gatewayUrl?: string; provider: string; model: string }) => Promise<{ ok: boolean; provider: string; model: string; confirmedProvider?: string; confirmedModel?: string }>;
  hermesServiceStatus: () => Promise<{ gateway: boolean; apiServer: boolean; dashboard: boolean }>;
  hermesStartAllServices: () => Promise<{ ok: boolean; gateway: boolean; apiServer: boolean; dashboard: boolean; message?: string }>;
  acpConnect: (payload?: { gatewayUrl?: string; cwd?: string }) => Promise<{ ok: boolean; sessionId: string }>;
  acpDisconnect: () => Promise<{ ok: boolean }>;
  acpCreateSession: (payload?: { cwd?: string }) => Promise<{ sessionId: string }>;
  acpPrompt: (payload: { sessionId: string; text: string }) => Promise<{ stopReason: string }>;
  acpListSessions: () => Promise<Array<{ id: string; title?: string; cwd?: string }>>;
  acpListModels: (payload?: { sessionId?: string }) => Promise<{ models: Array<{ id: string; name: string }>; currentModelId: string | null }>;
  acpSetSessionModel: (payload: { sessionId: string; model: string }) => Promise<{ ok: boolean; message?: string }>;
  acpCancel: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
  acpWorkspaceList: (payload?: { path?: string }) => Promise<{ items?: Array<{ path?: string; kind?: string; size?: number; modifiedMs?: number }>; truncated?: boolean }>;
  acpWorkspaceRead: (payload: { path: string }) => Promise<{ content?: string }>;
  acpWorkspaceStat: (payload: { path: string }) => Promise<{ kind?: string; size?: number; createdMs?: number; modifiedMs?: number }>;
  acpWorkspaceRename: (payload: { oldPath: string; newPath: string }) => Promise<{ ok?: boolean }>;
  acpWorkspaceDelete: (payload: { path: string }) => Promise<{ ok?: boolean }>;
  acpWorkspaceWrite: (payload: { path: string; content: string }) => Promise<{ ok?: boolean }>;
  acpKanbanExec: (payload: { sessionId?: string; args: string[]; timeoutMs?: number; requireJsonOutput?: boolean }) => Promise<{ stdout: string; exitCode: number | null; signal?: string | null }>;
  onAcpEvent: (handler: (event: { sessionId: string; update: unknown }) => void) => (() => void);
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  isWindowMaximized: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  showSystemMenu: (x: number, y: number) => Promise<void>;
  getDownloadsPath: () => Promise<string>;
  selectFolder: (initialPath?: string) => Promise<string | null>;
  selectFile: (initialPath?: string) => Promise<string | null>;
  selectContextPaths: (initialPath?: string) => Promise<Array<{ path: string; kind: 'file' | 'directory' }>>;
  planOrganizeFolder: (rootPath: string) => Promise<LocalFilePlanResult>;
  applyOrganizeFolderPlan: (rootPath: string, actions: LocalFilePlanAction[]) => Promise<LocalFileApplyResult>;
  createFileInFolder: (rootPath: string, relativePath: string, content: string, overwrite?: boolean) => Promise<LocalFileCreateResult>;
  appendFileInFolder: (rootPath: string, relativePath: string, content: string) => Promise<LocalFileAppendResult>;
  replaceInFile: (rootPath: string, relativePath: string, oldString: string, newString: string, replaceAll?: boolean) => Promise<LocalFileReplaceResult>;
  readFileInFolder: (rootPath: string, relativePath: string) => Promise<LocalFileReadResult>;
  listDirInFolder: (rootPath: string, relativePath?: string) => Promise<LocalFileListResult>;
  existsInFolder: (rootPath: string, relativePath: string) => Promise<LocalFileExistsResult>;
  renameInFolder: (rootPath: string, oldRelative: string, newRelative: string) => Promise<LocalFileRenameResult>;
  deleteInFolder: (rootPath: string, relativePath: string) => Promise<LocalFileDeleteResult>;
  statInFolder: (rootPath: string, relativePath: string) => Promise<LocalFileStatResult>;
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  shellExec: (rootPath: string, command: string, timeoutMs?: number) => Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>;
  webFetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; truncated: boolean }>;
  notify: (title: string, body?: string) => Promise<{ ok: boolean; message?: string }>;
};

declare global {
  interface Window {
    relay?: RelayApi;
  }
}

export {};
