import type { LocalActionType, SafetyPermissionScope, SafetyRiskLevel } from '@/app-types';

export const SAFETY_STORAGE_KEY = 'relay.safety.scopes';

function getSafetyStorageKey(projectId?: string): string {
  const normalizedProjectId = (projectId ?? '').trim();
  if (!normalizedProjectId) {
    return SAFETY_STORAGE_KEY;
  }
  return `${SAFETY_STORAGE_KEY}.project.${normalizedProjectId}`;
}

export const DEFAULT_SAFETY_SCOPES: SafetyPermissionScope[] = [
  { id: 'file-read', name: 'Read files', description: 'Agent can read files in the working folder', riskLevel: 'low', enabled: true, requiresApproval: false },
  { id: 'file-list', name: 'List directories', description: 'Agent can list directory contents', riskLevel: 'low', enabled: true, requiresApproval: false },
  { id: 'file-create', name: 'Create files', description: 'Agent can create new files in the working folder', riskLevel: 'medium', enabled: true, requiresApproval: true },
  { id: 'file-modify', name: 'Modify files', description: 'Agent can modify existing files', riskLevel: 'medium', enabled: true, requiresApproval: true },
  { id: 'file-delete', name: 'Delete files', description: 'Agent can remove files permanently', riskLevel: 'high', enabled: false, requiresApproval: true },
  { id: 'file-move', name: 'Move files', description: 'Agent can move files to other folders', riskLevel: 'medium', enabled: true, requiresApproval: true },
  { id: 'network-request', name: 'Network requests', description: 'Agent can send HTTP requests to external APIs', riskLevel: 'high', enabled: false, requiresApproval: true },
  { id: 'shell-execute', name: 'Shell commands', description: 'Agent can execute terminal commands', riskLevel: 'critical', enabled: false, requiresApproval: true },
  { id: 'email-send', name: 'Send emails', description: 'Agent can send emails via configured connectors', riskLevel: 'high', enabled: false, requiresApproval: true },
  { id: 'calendar-modify', name: 'Modify calendar', description: 'Agent can create or edit calendar entries', riskLevel: 'medium', enabled: false, requiresApproval: true },
  { id: 'data-export', name: 'Export data', description: 'Agent can export data from the app', riskLevel: 'medium', enabled: true, requiresApproval: false },
  { id: 'memory-write', name: 'Write memory', description: 'Agent can persist information permanently', riskLevel: 'low', enabled: true, requiresApproval: false },
];

export function loadSafetyScopes(projectId?: string): SafetyPermissionScope[] {
  try {
    const scopedKey = getSafetyStorageKey(projectId);
    const raw = localStorage.getItem(scopedKey);
    if (!raw) {
      // Backward-compatibility: if no project-specific scopes exist,
      // use global scopes as baseline.
      const legacyRaw = localStorage.getItem(SAFETY_STORAGE_KEY);
      if (!legacyRaw) {
        return DEFAULT_SAFETY_SCOPES;
      }
      return JSON.parse(legacyRaw) as SafetyPermissionScope[];
    }
    return JSON.parse(raw) as SafetyPermissionScope[];
  } catch {
    return DEFAULT_SAFETY_SCOPES;
  }
}

export function saveSafetyScopes(scopes: SafetyPermissionScope[], projectId?: string) {
  const scopedKey = getSafetyStorageKey(projectId);
  localStorage.setItem(scopedKey, JSON.stringify(scopes));
}

const localActionScopeMap: Record<LocalActionType, string> = {
  create_file: 'file-create',
  append_file: 'file-modify',
  read_file: 'file-read',
  list_dir: 'file-list',
  exists: 'file-read',
  rename: 'file-move',
  delete: 'file-delete',
  shell_exec: 'shell-execute',
  web_fetch: 'network-request',
};

type ResolvedLocalActionPolicy = {
  scopeId: string;
  scopeName: string;
  riskLevel: SafetyRiskLevel;
  enabled: boolean;
  requiresApproval: boolean;
};

function defaultPolicyForAction(actionType: LocalActionType): ResolvedLocalActionPolicy {
  if (actionType === 'shell_exec') {
    return { scopeId: 'shell-execute', scopeName: 'Shell commands', riskLevel: 'critical', enabled: false, requiresApproval: true };
  }
  if (actionType === 'web_fetch') {
    return { scopeId: 'network-request', scopeName: 'Network requests', riskLevel: 'high', enabled: false, requiresApproval: true };
  }
  const mutating = actionType === 'create_file' || actionType === 'append_file' || actionType === 'rename' || actionType === 'delete';
  return {
    scopeId: localActionScopeMap[actionType] ?? 'unknown',
    scopeName: mutating ? 'Mutating local action' : 'Read local action',
    riskLevel: mutating ? 'medium' : 'low',
    enabled: true,
    requiresApproval: mutating,
  };
}

export function resolveLocalActionPolicy(
  actionType: LocalActionType,
  scopes: SafetyPermissionScope[] = loadSafetyScopes(),
): ResolvedLocalActionPolicy {
  const scopeId = localActionScopeMap[actionType];
  const defaultPolicy = defaultPolicyForAction(actionType);
  if (!scopeId) {
    return defaultPolicy;
  }

  const scope = scopes.find((entry) => entry.id === scopeId);
  if (!scope) {
    return defaultPolicy;
  }

  return {
    scopeId,
    scopeName: scope.name,
    riskLevel: scope.riskLevel,
    enabled: scope.enabled,
    requiresApproval: scope.requiresApproval,
  };
}
