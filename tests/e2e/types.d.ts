/**
 * Type augmentation for window.relay inside Playwright evaluate() callbacks.
 * Mirrors the RelayApi interface declared in src/types.d.ts so that e2e tests
 * can reference window.relay without TypeScript errors.
 */
interface Window {
  relay?: {
    getConfig: () => Promise<any>;
    saveConfig: (config: { gatewayUrl: string; gatewayToken: string }) => Promise<any>;
    healthCheck: (baseUrl: string) => Promise<any>;
    discoverGateway: () => Promise<any>;
    checkWorkspacePlugin: () => Promise<{ installed: boolean; error?: string }>;
    installWorkspacePlugin: () => Promise<{ ok: boolean; output?: string; error?: string }>;
    minimizeWindow: () => Promise<void>;
    toggleMaximizeWindow: () => Promise<boolean>;
    isWindowMaximized: () => Promise<boolean>;
    closeWindow: () => Promise<void>;
    showSystemMenu: (x: number, y: number) => Promise<void>;
    getDownloadsPath: () => Promise<string>;
    selectFolder: (initialPath?: string) => Promise<string | null>;
    planOrganizeFolder: (rootPath: string) => Promise<any>;
    applyOrganizeFolderPlan: (rootPath: string, actions: any[]) => Promise<any>;
    createFileInFolder: (rootPath: string, relativePath: string, content: string, overwrite?: boolean) => Promise<any>;
    appendFileInFolder: (rootPath: string, relativePath: string, content: string) => Promise<any>;
    readFileInFolder: (rootPath: string, relativePath: string) => Promise<{ filePath: string; content: string }>;
    listDirInFolder: (rootPath: string, relativePath?: string) => Promise<any>;
    existsInFolder: (rootPath: string, relativePath: string) => Promise<{ path: string; exists: boolean; kind: string }>;
    renameInFolder: (rootPath: string, oldRelative: string, newRelative: string) => Promise<any>;
    deleteInFolder: (rootPath: string, relativePath: string) => Promise<any>;
    statInFolder: (rootPath: string, relativePath: string) => Promise<any>;
    openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  };
}
