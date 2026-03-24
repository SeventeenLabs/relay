import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Eye,
  File,
  FileCode,
  FileImage,
  FilePlus,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  GitCompare,
  HardDrive,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { LocalFileListItem } from '@/app-types';
import type { FileService } from '@/lib/file-service';
import { WorkspaceRpcUnsupportedError } from '@/lib/file-service';

/* ═══════════════════════════════════════════ Types ═══════════════════════════════════════════ */

type FilesPageProps = {
  workingFolder: string;
  desktopBridgeAvailable: boolean;
  onPickFolder: () => void;
  fileService: FileService;
  localFileService?: FileService | null;
};

type ExplorerRoot = 'workspace' | 'working-folder';

type TreeNode = {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  size?: number;
  modifiedMs?: number;
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
  depth: number;
  changeStatus?: 'created' | 'modified' | 'deleted' | 'moved' | 'pending';
};

type UndoEntry = {
  id: string;
  ts: number;
  label: string;
  type: 'rename' | 'delete' | 'create';
  oldPath: string;
  newPath?: string;
  content?: string;
};

type ContextMenuState = {
  x: number;
  y: number;
  item: TreeNode;
} | null;

/* ═══════════════════════════════════════ Utilities ═══════════════════════════════════════ */

const EXT_ICONS: Record<string, typeof File> = {
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, py: FileCode, rs: FileCode,
  go: FileCode, java: FileCode, c: FileCode, cpp: FileCode, h: FileCode, css: FileCode,
  html: FileCode, json: FileCode, yaml: FileCode, yml: FileCode, toml: FileCode, xml: FileCode,
  sql: FileCode, sh: FileCode, md: FileText, txt: FileText, log: FileText,
  csv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet,
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage, ico: FileImage, bmp: FileImage,
};

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', rs: 'rust',
  go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c', css: 'css', html: 'html',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', sql: 'sql', sh: 'bash',
  md: 'markdown', txt: 'text', log: 'text', csv: 'csv',
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

const RISK_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  low: { dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  medium: { dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  high: { dot: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400' },
  critical: { dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
};

const CHANGE_COLORS: Record<string, string> = {
  created: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-blue-600 dark:text-blue-400',
  deleted: 'text-red-600 dark:text-red-400',
  moved: 'text-amber-600 dark:text-amber-400',
  pending: 'text-yellow-600 dark:text-yellow-400',
};

function getFileIcon(name: string): typeof File {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_ICONS[ext] || File;
}

function getFileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes < 0) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Gerade eben';
  if (diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} Min.`;
  if (diff < 86_400_000) return `vor ${Math.floor(diff / 3_600_000)} Std.`;
  if (diff < 604_800_000) return `vor ${Math.floor(diff / 86_400_000)} T.`;
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function buildBreadcrumbs(rootPath: string, currentPath: string): { label: string; relPath: string }[] {
  const root = rootPath.replace(/\\/g, '/');
  const current = currentPath.replace(/\\/g, '/');
  if (current === root || current === '') return [];
  const relativePart = current.startsWith('/') ? current : `/${current}`;
  const parts = relativePart.split('/').filter(Boolean);
  const crumbs: { label: string; relPath: string }[] = [];
  let acc = '';
  for (const part of parts) {
    acc += acc ? `/${part}` : part;
    crumbs.push({ label: part, relPath: acc });
  }
  return crumbs;
}

function buildTreeFromItems(items: LocalFileListItem[], currentRelPath: string, depth: number, changeLog: Map<string, string>): TreeNode[] {
  return items
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
    })
    .map((item) => {
      const name = item.path.includes('/') ? item.path.split('/').pop()! : item.path;
      const relPath = currentRelPath ? `${currentRelPath}/${name}` : name;
      return {
        name,
        relativePath: relPath,
        kind: item.kind,
        size: item.size,
        modifiedMs: item.modifiedMs,
        depth,
        changeStatus: changeLog.get(relPath) as TreeNode['changeStatus'],
      };
    });
}

/* Simple line-level diff for before/after comparison */
function computeLineDiff(oldText: string, newText: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', text: oldLines[oi] });
      oi++;
      ni++;
    } else if (oi < oldLines.length && (ni >= newLines.length || !newLines.includes(oldLines[oi]))) {
      result.push({ type: 'removed', text: oldLines[oi] });
      oi++;
    } else {
      result.push({ type: 'added', text: newLines[ni] ?? '' });
      ni++;
    }
  }
  return result;
}

/* Keyword-based syntax highlighting (simple token colorizer) */
function syntaxHighlight(code: string, lang: string): { spans: { text: string; color: string }[] }[] {
  const keywords: Record<string, Set<string>> = {
    typescript: new Set(['import','export','from','const','let','var','function','return','if','else','for','while','type','interface','class','extends','implements','new','async','await','try','catch','throw','switch','case','break','default','void','null','undefined','true','false','typeof','instanceof']),
    javascript: new Set(['import','export','from','const','let','var','function','return','if','else','for','while','class','extends','new','async','await','try','catch','throw','switch','case','break','default','void','null','undefined','true','false','typeof','instanceof']),
    python: new Set(['import','from','def','return','if','elif','else','for','while','class','try','except','raise','with','as','pass','break','continue','lambda','yield','None','True','False','self','and','or','not','in','is']),
    rust: new Set(['fn','let','mut','pub','use','mod','struct','enum','impl','trait','for','while','if','else','match','return','self','super','crate','where','async','await','move','type','const','static','true','false']),
    json: new Set([]),
    css: new Set([]),
    html: new Set([]),
  };
  const kws = keywords[lang] ?? keywords.typescript ?? new Set();
  return code.split('\n').map((line) => {
    const spans: { text: string; color: string }[] = [];
    // comment lines
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('#')) {
      spans.push({ text: line, color: 'text-emerald-600/70 dark:text-emerald-400/70' });
      return { spans };
    }
    // string-only lines or lines with mostly strings
    const tokens = line.split(/(\s+|[{}()[\];,.:=<>!&|?+\-*/])/);
    for (const token of tokens) {
      if (!token) continue;
      if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
        spans.push({ text: token, color: 'text-amber-700 dark:text-amber-300' });
      } else if (kws.has(token)) {
        spans.push({ text: token, color: 'text-purple-600 dark:text-purple-400' });
      } else if (/^\d+\.?\d*$/.test(token)) {
        spans.push({ text: token, color: 'text-blue-600 dark:text-blue-400' });
      } else {
        spans.push({ text: token, color: '' });
      }
    }
    return { spans };
  });
}

/* ═══════════════════════════════════ Permission Scope Reference ═══════════════════════════════════ */

type PermissionRef = {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
};

const FILE_PERMISSIONS: PermissionRef[] = [
  { id: 'file-read', name: 'Lesen', risk: 'low' },
  { id: 'file-list', name: 'Auflisten', risk: 'low' },
  { id: 'file-create', name: 'Erstellen', risk: 'medium' },
  { id: 'file-modify', name: 'Ändern', risk: 'medium' },
  { id: 'file-delete', name: 'Löschen', risk: 'high' },
  { id: 'file-move', name: 'Verschieben', risk: 'medium' },
];

/* ═══════════════════════════════════════════ Main Component ═══════════════════════════════════════════ */

export function FilesPage({ workingFolder, desktopBridgeAvailable, onPickFolder, fileService, localFileService }: FilesPageProps) {
  /* ── State ── */
  const [currentRelPath, setCurrentRelPath] = useState('');
  const [items, setItems] = useState<LocalFileListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Tree expansion state
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childCache, setChildCache] = useState<Map<string, LocalFileListItem[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // Selection & preview
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<'preview' | 'diff' | 'info'>('preview');

  // Diff state
  const [diffOldContent, setDiffOldContent] = useState('');
  const [diffNewContent, setDiffNewContent] = useState('');

  // Search & filter
  const [filterQuery, setFilterQuery] = useState('');

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // Rename dialog
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // New file/folder dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'file' | 'directory'>('file');
  const [createName, setCreateName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Change tracker for agent activity (green/red/yellow indicators)
  const [changeLog, setChangeLog] = useState<Map<string, string>>(new Map());

  // Undo stack
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [showUndoPanel, setShowUndoPanel] = useState(false);

  // Permission overlay
  const [showPermissions, setShowPermissions] = useState(false);

  // Drag state
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  // File info
  const [fileInfo, setFileInfo] = useState<{ size: number; createdMs: number; modifiedMs: number; kind: string } | null>(null);

  // Remote unsupported state
  const [remoteUnsupported, setRemoteUnsupported] = useState(false);
  const [agentTools, setAgentTools] = useState<Array<{ name: string; group?: string }>>([]);
  const [agentHasFileTools, setAgentHasFileTools] = useState(false);

  const isRemote = fileService.mode === 'remote';
  const localWorkingFolderAvailable = Boolean(localFileService && desktopBridgeAvailable && workingFolder.trim());
  const [activeRoot, setActiveRoot] = useState<ExplorerRoot>('workspace');

  useEffect(() => {
    if (!localWorkingFolderAvailable && activeRoot === 'working-folder') {
      setActiveRoot('workspace');
    }
  }, [activeRoot, localWorkingFolderAvailable]);

  const activeExplorerService = useMemo(() => {
    if (activeRoot === 'working-folder' && localWorkingFolderAvailable && localFileService) {
      return localFileService;
    }
    return fileService;
  }, [activeRoot, localWorkingFolderAvailable, localFileService, fileService]);

  const activeRootPath = activeRoot === 'working-folder' ? workingFolder : (isRemote ? '' : workingFolder);
  const showRootSwitcher = isRemote && localWorkingFolderAvailable;

  /* ── Directory Loading ── */
  const loadDirectory = useCallback(
    async (relPath: string) => {
      setLoading(true);
      setError('');
      try {
        const result = await activeExplorerService.listDir(activeRootPath, relPath || undefined);
        const sorted = [...result.items].sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
        });
        setItems(sorted);
        setCurrentRelPath(relPath);
        setSelectedPath(null);
        setPreviewContent('');
        setDiffOldContent('');
        setDiffNewContent('');
        setFileInfo(null);
        setRemoteUnsupported(false);
      } catch (err) {
        if (err instanceof WorkspaceRpcUnsupportedError) {
          setRemoteUnsupported(true);
          setError('');
          // Fetch tool catalog to show what the agent can do
          fileService.fetchToolsCatalog().then((tools) => {
            if (tools) setAgentTools(tools.map((t) => ({ name: t.name, group: t.group })));
          }).catch(() => {});
          fileService.hasFileTools().then(setAgentHasFileTools).catch(() => {});
        } else {
          setError(err instanceof Error ? err.message : 'Fehler beim Laden');
        }
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [activeExplorerService, activeRootPath, fileService],
  );

  const loadSubDir = useCallback(
    async (relPath: string) => {
      setLoadingDirs((prev) => new Set(prev).add(relPath));
      try {
        const result = await activeExplorerService.listDir(activeRootPath, relPath);
        setChildCache((prev) => new Map(prev).set(relPath, result.items));
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(relPath);
          return next;
        });
      }
    },
    [activeExplorerService, activeRootPath],
  );

  useEffect(() => {
    if ((desktopBridgeAvailable || isRemote) && (activeRootPath || isRemote)) {
      void loadDirectory('');
    }
  }, [activeRootPath, desktopBridgeAvailable, isRemote, loadDirectory]);

  /* ── Navigation ── */
  const navigateUp = useCallback(() => {
    const parts = currentRelPath.split('/').filter(Boolean);
    parts.pop();
    void loadDirectory(parts.join('/'));
  }, [currentRelPath, loadDirectory]);

  const navigateToDir = useCallback(
    (relPath: string) => void loadDirectory(relPath),
    [loadDirectory],
  );

  /* ── Tree expand/collapse ── */
  const toggleExpand = useCallback(
    (node: TreeNode) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(node.relativePath)) {
          next.delete(node.relativePath);
        } else {
          next.add(node.relativePath);
          if (!childCache.has(node.relativePath)) {
            void loadSubDir(node.relativePath);
          }
        }
        return next;
      });
    },
    [childCache, loadSubDir],
  );

  /* ── Preview ── */
  const openPreview = useCallback(
    async (node: TreeNode) => {
      if (node.kind !== 'file') return;
      setSelectedPath(node.relativePath);
      setPreviewTab('preview');
      setPreviewLoading(true);
      setPreviewContent('');
      setDiffOldContent('');
      setDiffNewContent('');
      try {
        const result = await activeExplorerService.readFile(activeRootPath, node.relativePath);
        setPreviewContent(result.content);
        // Also load file info
        try {
          const stat = await activeExplorerService.stat(activeRootPath, node.relativePath);
          setFileInfo({ size: stat.size, createdMs: stat.createdMs, modifiedMs: stat.modifiedMs, kind: stat.kind });
        } catch {
          setFileInfo(null);
        }
      } catch (err) {
        setPreviewContent(`Fehler: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
        setFileInfo(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [activeExplorerService, activeRootPath],
  );

  /* ── File Operations ── */
  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenameLoading(true);
    try {
      const dir = renameTarget.relativePath.includes('/')
        ? renameTarget.relativePath.substring(0, renameTarget.relativePath.lastIndexOf('/'))
        : '';
      const newRelPath = dir ? `${dir}/${renameValue.trim()}` : renameValue.trim();
      // Save old content for undo if it's a file
      let oldContent: string | undefined;
      if (renameTarget.kind === 'file') {
        try {
          const r = await activeExplorerService.readFile(activeRootPath, renameTarget.relativePath);
          oldContent = r.content;
        } catch { /* ok */ }
      }
      await activeExplorerService.rename(activeRootPath, renameTarget.relativePath, newRelPath);
      setUndoStack((prev) => [...prev, {
        id: crypto.randomUUID(),
        ts: Date.now(),
        label: `Umbenannt: ${renameTarget.name} → ${renameValue.trim()}`,
        type: 'rename',
        oldPath: renameTarget.relativePath,
        newPath: newRelPath,
        content: oldContent,
      }]);
      setChangeLog((prev) => new Map(prev).set(newRelPath, 'moved'));
      setRenameDialogOpen(false);
      void loadDirectory(currentRelPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Umbenennung fehlgeschlagen');
    } finally {
      setRenameLoading(false);
    }
  }, [activeExplorerService, activeRootPath, renameTarget, renameValue, currentRelPath, loadDirectory]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      // Save content for undo if file
      let oldContent: string | undefined;
      if (deleteTarget.kind === 'file') {
        try {
          const r = await activeExplorerService.readFile(activeRootPath, deleteTarget.relativePath);
          oldContent = r.content;
        } catch { /* ok */ }
      }
      await activeExplorerService.deleteFile(activeRootPath, deleteTarget.relativePath);
      setUndoStack((prev) => [...prev, {
        id: crypto.randomUUID(),
        ts: Date.now(),
        label: `Gelöscht: ${deleteTarget.name}`,
        type: 'delete',
        oldPath: deleteTarget.relativePath,
        content: oldContent,
      }]);
      setChangeLog((prev) => new Map(prev).set(deleteTarget.relativePath, 'deleted'));
      if (selectedPath === deleteTarget.relativePath) {
        setSelectedPath(null);
        setPreviewContent('');
      }
      setDeleteDialogOpen(false);
      void loadDirectory(currentRelPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setDeleteLoading(false);
    }
  }, [activeExplorerService, activeRootPath, deleteTarget, currentRelPath, selectedPath, loadDirectory]);

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return;
    setCreateLoading(true);
    try {
      const relPath = currentRelPath ? `${currentRelPath}/${createName.trim()}` : createName.trim();
      if (createKind === 'file') {
        await activeExplorerService.createFile(activeRootPath, relPath, '');
      } else {
        // Create a directory by creating a placeholder file
        await activeExplorerService.createFile(activeRootPath, `${relPath}/.gitkeep`, '');
      }
      setUndoStack((prev) => [...prev, {
        id: crypto.randomUUID(),
        ts: Date.now(),
        label: `Erstellt: ${createName.trim()}`,
        type: 'create',
        oldPath: relPath,
      }]);
      setChangeLog((prev) => new Map(prev).set(relPath, 'created'));
      setCreateDialogOpen(false);
      setCreateName('');
      void loadDirectory(currentRelPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erstellen fehlgeschlagen');
    } finally {
      setCreateLoading(false);
    }
  }, [activeExplorerService, activeRootPath, createName, createKind, currentRelPath, loadDirectory]);

  const handleUndo = useCallback(async (entry: UndoEntry) => {
    try {
      if (entry.type === 'rename' && entry.newPath) {
        await activeExplorerService.rename(activeRootPath, entry.newPath, entry.oldPath);
      } else if (entry.type === 'delete' && entry.content !== undefined) {
        await activeExplorerService.createFile(activeRootPath, entry.oldPath, entry.content);
      } else if (entry.type === 'create') {
        await activeExplorerService.deleteFile(activeRootPath, entry.oldPath);
      }
      setUndoStack((prev) => prev.filter((e) => e.id !== entry.id));
      setChangeLog((prev) => {
        const next = new Map(prev);
        next.delete(entry.oldPath);
        if (entry.newPath) next.delete(entry.newPath);
        return next;
      });
      void loadDirectory(currentRelPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rückgängig fehlgeschlagen');
    }
  }, [activeExplorerService, activeRootPath, currentRelPath, loadDirectory]);

  /* ── Drop handler ── */
  const handleDrop = useCallback(
    async (e: React.DragEvent, targetDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const text = await file.text();
          const relPath = targetDir ? `${targetDir}/${file.name}` : file.name;
          await activeExplorerService.createFile(activeRootPath, relPath, text);
          setChangeLog((prev) => new Map(prev).set(relPath, 'created'));
        } catch { /* skip failed drops */ }
      }
      void loadDirectory(currentRelPath);
    },
    [activeExplorerService, activeRootPath, currentRelPath, loadDirectory],
  );

  /* ── Context menu close on click outside ── */
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  /* ── Build tree ── */
  const tree = useMemo(
    () => buildTreeFromItems(items, currentRelPath, 0, changeLog),
    [items, currentRelPath, changeLog],
  );

  const filteredTree = useMemo(() => {
    if (!filterQuery.trim()) return tree;
    const q = filterQuery.toLowerCase();
    return tree.filter((n) => n.name.toLowerCase().includes(q));
  }, [tree, filterQuery]);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(activeRootPath, currentRelPath), [activeRootPath, currentRelPath]);

  const stats = useMemo(() => {
    const dirs = items.filter((i) => i.kind === 'directory').length;
    const files = items.length - dirs;
    const totalSize = items.reduce((acc, i) => acc + (i.size || 0), 0);
    return { dirs, files, totalSize };
  }, [items]);

  const selectedNode = useMemo(
    () => (selectedPath ? tree.find((n) => n.relativePath === selectedPath) : null),
    [selectedPath, tree],
  );

  const selectedExt = selectedPath ? getFileExt(selectedPath) : '';
  const selectedLang = EXT_LANG[selectedExt] || 'text';
  const isImage = IMAGE_EXTS.has(selectedExt);

  /* ── Keyboard nav ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = selectedPath ? filteredTree.findIndex((n) => n.relativePath === selectedPath) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(idx + 1, filteredTree.length - 1);
        setSelectedPath(filteredTree[next]?.relativePath ?? null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        setSelectedPath(filteredTree[prev]?.relativePath ?? null);
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        const node = filteredTree[idx];
        if (node.kind === 'directory') navigateToDir(node.relativePath);
        else void openPreview(node);
      } else if (e.key === 'Backspace' && !filterQuery) {
        navigateUp();
      } else if (e.key === 'Delete' && idx >= 0) {
        e.preventDefault();
        setDeleteTarget(filteredTree[idx]);
        setDeleteDialogOpen(true);
      } else if (e.key === 'F2' && idx >= 0) {
        e.preventDefault();
        const node = filteredTree[idx];
        setRenameTarget(node);
        setRenameValue(node.name);
        setRenameDialogOpen(true);
      }
    },
    [selectedPath, filteredTree, filterQuery, navigateToDir, navigateUp, openPreview],
  );

  /* ── Render: diff view ── */
  const diffLines = useMemo(
    () => (diffOldContent && diffNewContent ? computeLineDiff(diffOldContent, diffNewContent) : []),
    [diffOldContent, diffNewContent],
  );

  /* ── Syntax highlight preview ── */
  const highlightedLines = useMemo(
    () => (previewContent && !isImage ? syntaxHighlight(previewContent, selectedLang) : []),
    [previewContent, isImage, selectedLang],
  );

  const switchRoot = useCallback((nextRoot: ExplorerRoot) => {
    setActiveRoot(nextRoot);
    setCurrentRelPath('');
    setItems([]);
    setExpandedDirs(new Set());
    setChildCache(new Map());
    setSelectedPath(null);
    setPreviewContent('');
    setDiffOldContent('');
    setDiffNewContent('');
    setFileInfo(null);
    setFilterQuery('');
    setError('');
    setRemoteUnsupported(false);
  }, []);

  /* ── Render: not available ── */
  if (!desktopBridgeAvailable && !isRemote) {
    return (
      <section className="flex h-full items-center justify-center">
        <div className="text-center">
          <HardDrive className="mx-auto mb-3 size-10 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">Dateisystem nicht verfügbar</h2>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Der File Explorer benötigt die Desktop-App oder eine Verbindung zu einem Remote-Server.
          </p>
        </div>
      </section>
    );
  }

  /* ── Render: remote server doesn't support workspace RPCs ── */
  if (remoteUnsupported && activeRoot === 'workspace') {
    const fsTools = agentTools.filter((t) => ['read', 'write', 'edit', 'apply_patch'].includes(t.name));
    return (
      <section className="flex h-full items-center justify-center overflow-y-auto p-6">
        <div className="max-w-lg text-center">
          <AlertTriangle className="mx-auto mb-3 size-10 text-amber-500" />
          <h2 className="text-lg font-medium">Datei-Explorer im Remote-Modus nicht verfügbar</h2>
          <p className="mt-2 font-sans text-sm text-muted-foreground">
            Das OpenClaw-Gateway stellt derzeit keine direkten Datei-Zugriffs-RPCs bereit.
            Der Agent hat seine eigenen Dateiwerkzeuge, die er im Chat verwenden kann.
          </p>

          {agentHasFileTools && fsTools.length > 0 && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-left">
              <p className="mb-2 font-sans text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Agent-Dateiwerkzeuge verfügbar (group:fs):
              </p>
              <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                {fsTools.map((t) => (
                  <li key={t.name} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {t.name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-sans text-xs text-muted-foreground">
                Diese Werkzeuge nutzt der Agent im Chat.
                Frage ihn z.B.: <em>&quot;Liste alle Dateien im Workspace&quot;</em> oder{' '}
                <em>&quot;Lese die Datei AGENTS.md&quot;</em>.
              </p>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-4 text-left">
            <p className="mb-2 font-sans text-xs font-medium text-foreground/80">Warum kein direkter Zugriff?</p>
            <p className="font-sans text-xs text-muted-foreground">
              Der Agent-Workspace liegt auf dem Gateway-Host
              (Standard: <code className="rounded bg-muted px-1 py-0.5">~/.openclaw/workspace</code>).
              Die Datei-Werkzeuge (<code className="rounded bg-muted px-1 py-0.5">read</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5">write</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5">edit</code>) werden{' '}
              vom KI-Modell während des Chats aufgerufen, nicht direkt über das Gateway-Protokoll.
            </p>
          </div>

          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            {showRootSwitcher && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => switchRoot('working-folder')}
              >
                <HardDrive className="mr-1.5 size-3.5" />
                Zum lokalen Arbeitsordner
              </Button>
            )}
            {desktopBridgeAvailable && (
              <Button type="button" variant="outline" size="sm" onClick={onPickFolder}>
                <Folder className="mr-1.5 size-3.5" />
                Lokalen Ordner wählen
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  /* ── Render helper: tree row ── */
  const renderTreeNode = (node: TreeNode) => {
    const isDir = node.kind === 'directory';
    const Icon = isDir ? (expandedDirs.has(node.relativePath) ? FolderOpen : Folder) : getFileIcon(node.name);
    const isSelected = selectedPath === node.relativePath;
    const isExpanded = expandedDirs.has(node.relativePath);
    const isLoadingChildren = loadingDirs.has(node.relativePath);
    const changeColor = node.changeStatus ? CHANGE_COLORS[node.changeStatus] : '';
    const children = isDir && isExpanded ? childCache.get(node.relativePath) : undefined;

    return (
      <div key={node.relativePath}>
        <button
          type="button"
          className={`group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            isSelected ? 'bg-accent/60 ring-1 ring-accent/80' : dragOverPath === node.relativePath ? 'bg-blue-100/60 dark:bg-blue-900/30' : 'hover:bg-accent/20'
          }`}
          style={{ paddingLeft: `${12 + node.depth * 16}px` }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedPath(node.relativePath);
            if (isDir) {
              toggleExpand(node);
            } else {
              void openPreview(node);
            }
          }}
          onDoubleClick={() => {
            if (isDir) navigateToDir(node.relativePath);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, item: node });
          }}
          onDragOver={(e) => {
            if (isDir) {
              e.preventDefault();
              setDragOverPath(node.relativePath);
            }
          }}
          onDragLeave={() => setDragOverPath(null)}
          onDrop={(e) => {
            if (isDir) void handleDrop(e, node.relativePath);
          }}
        >
          {isDir && (
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          )}
          {!isDir && <span className="w-3" />}
          <Icon
            className={`size-4 shrink-0 ${
              changeColor || (isDir ? 'text-amber-600/80 dark:text-amber-400/80' : 'text-muted-foreground/70')
            }`}
          />
          <span className={`min-w-0 flex-1 truncate font-sans text-[13px] ${changeColor}`}>
            {node.name}
          </span>
          {node.changeStatus && (
            <span className={`size-2 shrink-0 rounded-full ${
              node.changeStatus === 'created' ? 'bg-emerald-500' :
              node.changeStatus === 'modified' ? 'bg-blue-500' :
              node.changeStatus === 'deleted' ? 'bg-red-500' :
              node.changeStatus === 'moved' ? 'bg-amber-500' :
              'bg-yellow-500'
            }`} title={node.changeStatus} />
          )}
          {node.modifiedMs && (
            <span className="hidden shrink-0 font-sans text-[10px] text-muted-foreground/50 group-hover:inline">
              {relativeTime(node.modifiedMs)}
            </span>
          )}
          {node.size !== undefined && !isDir && (
            <span className="shrink-0 font-sans text-[11px] text-muted-foreground/50">
              {formatSize(node.size)}
            </span>
          )}
          {isLoadingChildren && (
            <RefreshCw className="size-3 shrink-0 animate-spin text-muted-foreground/40" />
          )}
        </button>
        {/* Render expanded children */}
        {isDir && isExpanded && children && (
          <div>
            {buildTreeFromItems(children, node.relativePath, node.depth + 1, changeLog)
              .filter((child) => !filterQuery.trim() || child.name.toLowerCase().includes(filterQuery.toLowerCase()))
              .map((child) => renderTreeNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: selectedPath ? '1fr 1fr' : '1fr' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleDrop(e, currentRelPath)}
    >
      {/* ════════════════════════ Left: File Tree Panel ════════════════════════ */}
      <div className="flex min-h-0 flex-col" onKeyDown={handleKeyDown} tabIndex={0}>
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
          {showRootSwitcher && (
            <>
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] ${activeRoot === 'workspace' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                onClick={() => switchRoot('workspace')}
              >
                OpenClaw Workspace
              </button>
              <button
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] ${activeRoot === 'working-folder' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                onClick={() => switchRoot('working-folder')}
              >
                Lokaler Arbeitsordner
              </button>
              <Separator orientation="vertical" className="mx-1 h-4" />
            </>
          )}
          <Button type="button" variant="ghost" size="icon-xs" className="size-6" onClick={navigateUp} title="Übergeordnet">
            <FolderUp className="size-3.5" />
          </Button>
          <Separator orientation="vertical" className="mx-1 h-4" />

          {/* Breadcrumbs */}
          <div className="flex items-center gap-0.5 overflow-x-auto text-[12px]">
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => void loadDirectory('')}
              title={activeRootPath || 'OpenClaw Workspace'}
            >
              <HardDrive className="inline size-3" />
            </button>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.relPath} className="flex items-center gap-0.5">
                <ChevronRight className="size-3 text-muted-foreground/50" />
                <button
                  type="button"
                  className={`shrink-0 rounded px-1 py-0.5 ${
                    i === breadcrumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                  onClick={() => void loadDirectory(crumb.relPath)}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>

          {/* Remote mode indicator */}
          {isRemote && (
            <Badge variant="outline" className="ml-1 shrink-0 border-blue-500/40 bg-blue-50 text-[10px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
              {activeRoot === 'workspace' ? 'Remote Workspace' : 'Local Folder'}
            </Badge>
          )}

          {/* Action buttons */}
          <div className="ml-auto flex items-center gap-0.5">
            {undoStack.length > 0 && (
              <Button
                type="button" variant="ghost" size="icon-xs" className="size-6"
                onClick={() => setShowUndoPanel(!showUndoPanel)}
                title={`${undoStack.length} Aktionen rückgängig`}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            <Button
              type="button" variant="ghost" size="icon-xs" className="size-6"
              onClick={() => setShowPermissions(!showPermissions)}
              title="Berechtigungen"
            >
              <Shield className={`size-3.5 ${showPermissions ? 'text-blue-600' : ''}`} />
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            <Button
              type="button" variant="ghost" size="icon-xs" className="size-6"
              onClick={() => { setCreateKind('file'); setCreateName(''); setCreateDialogOpen(true); }}
              title="Neue Datei"
            >
              <FilePlus className="size-3.5" />
            </Button>
            <Button
              type="button" variant="ghost" size="icon-xs" className="size-6"
              onClick={() => { setCreateKind('directory'); setCreateName(''); setCreateDialogOpen(true); }}
              title="Neuer Ordner"
            >
              <FolderPlus className="size-3.5" />
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            <Button type="button" variant="ghost" size="icon-xs" className="size-6" onClick={() => void loadDirectory(currentRelPath)} title="Aktualisieren">
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="size-6" onClick={onPickFolder} title="Ordner wählen">
              <FolderOpen className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Permission overlay */}
        {showPermissions && (
          <div className="border-b border-border/40 bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <Shield className="size-3.5 text-muted-foreground" />
              <span className="font-sans text-[11px] font-medium text-muted-foreground">Agent-Berechtigungen für diesen Ordner</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILE_PERMISSIONS.map((perm) => {
                const colors = RISK_COLORS[perm.risk];
                return (
                  <span key={perm.id} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                    <span className={`size-1.5 rounded-full ${colors.dot}`} />
                    {perm.name}
                    <span className="opacity-60">({perm.risk})</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Undo panel */}
        {showUndoPanel && undoStack.length > 0 && (
          <div className="border-b border-border/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
            <div className="flex items-center gap-2 mb-1.5">
              <RotateCcw className="size-3.5 text-amber-700 dark:text-amber-400" />
              <span className="font-sans text-[11px] font-medium text-amber-800 dark:text-amber-300">
                Letzte Aktionen ({undoStack.length})
              </span>
              <button
                type="button"
                className="ml-auto text-[10px] text-amber-600 hover:underline dark:text-amber-400"
                onClick={() => setShowUndoPanel(false)}
              >
                Schließen
              </button>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {[...undoStack].reverse().map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 rounded bg-white/60 dark:bg-white/5 px-2 py-1">
                  <span className="min-w-0 truncate font-sans text-[11px] text-foreground/80">{entry.label}</span>
                  <span className="shrink-0 font-sans text-[10px] text-muted-foreground">{relativeTime(entry.ts)}</span>
                  <Button
                    type="button" variant="ghost" size="icon-xs" className="size-5 shrink-0"
                    onClick={() => void handleUndo(entry)}
                    title="Rückgängig"
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
          <Search className="size-3.5 text-muted-foreground/60" />
          <Input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Dateien filtern..."
            className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
          />
          {filterQuery && (
            <Button type="button" variant="ghost" size="icon-xs" className="size-5" onClick={() => setFilterQuery('')}>
              <X className="size-3" />
            </Button>
          )}
          <span className="ml-auto whitespace-nowrap font-sans text-[11px] text-muted-foreground">
            {stats.dirs} Ordner · {stats.files} Dateien{stats.totalSize > 0 ? ` · ${formatSize(stats.totalSize)}` : ''}
          </span>
        </div>

        {/* Tree listing */}
        <ScrollArea className="flex-1">
          {error ? (
            <div className="p-4 font-sans text-sm text-destructive">
              <AlertTriangle className="mb-1 inline size-4" /> {error}
              <Button type="button" variant="link" size="sm" className="ml-2 h-auto p-0 text-sm" onClick={() => setError('')}>
                Schließen
              </Button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <RefreshCw className="mr-2 size-4 animate-spin" /> Lade Dateien...
            </div>
          ) : filteredTree.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center"
              onDragOver={(e) => { e.preventDefault(); setDragOverPath('__root__'); }}
              onDragLeave={() => setDragOverPath(null)}
              onDrop={(e) => void handleDrop(e, currentRelPath)}
            >
              <Upload className={`mb-2 size-8 ${dragOverPath === '__root__' ? 'text-blue-500 animate-bounce' : 'text-muted-foreground/40'}`} />
              <p className="font-sans text-sm text-muted-foreground">
                {filterQuery ? 'Keine Treffer' : 'Leerer Ordner — Dateien hierher ziehen'}
              </p>
            </div>
          ) : (
            <div className="py-0.5">
              {filteredTree.map((node) => renderTreeNode(node))}
            </div>
          )}
        </ScrollArea>

        {/* Change log indicator bar */}
        {changeLog.size > 0 && (
          <div className="flex items-center gap-3 border-t border-border/40 bg-muted/20 px-3 py-1.5">
            <span className="font-sans text-[10px] font-medium text-muted-foreground">Änderungen:</span>
            {[...changeLog.values()].filter((v) => v === 'created').length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {[...changeLog.values()].filter((v) => v === 'created').length} neu
              </span>
            )}
            {[...changeLog.values()].filter((v) => v === 'modified').length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
                <span className="size-1.5 rounded-full bg-blue-500" />
                {[...changeLog.values()].filter((v) => v === 'modified').length} geändert
              </span>
            )}
            {[...changeLog.values()].filter((v) => v === 'deleted').length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                <span className="size-1.5 rounded-full bg-red-500" />
                {[...changeLog.values()].filter((v) => v === 'deleted').length} gelöscht
              </span>
            )}
            {[...changeLog.values()].filter((v) => v === 'moved').length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                <span className="size-1.5 rounded-full bg-amber-500" />
                {[...changeLog.values()].filter((v) => v === 'moved').length} verschoben
              </span>
            )}
            <button
              type="button"
              className="ml-auto font-sans text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setChangeLog(new Map())}
            >
              Zurücksetzen
            </button>
          </div>
        )}
      </div>

      {/* ════════════════════════ Right: Preview Panel ════════════════════════ */}
      {selectedPath && (
        <div className="flex min-h-0 flex-col border-l border-border/60">
          {/* Preview header with tabs */}
          <div className="flex items-center gap-1 border-b border-border/60 px-3 py-1.5">
            <button
              type="button"
              className={`rounded px-2 py-1 font-sans text-[11px] transition-colors ${previewTab === 'preview' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setPreviewTab('preview')}
            >
              <Eye className="mr-1 inline size-3" />Vorschau
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 font-sans text-[11px] transition-colors ${previewTab === 'diff' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setPreviewTab('diff')}
            >
              <GitCompare className="mr-1 inline size-3" />Diff
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 font-sans text-[11px] transition-colors ${previewTab === 'info' ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setPreviewTab('info')}
            >
              <Clock className="mr-1 inline size-3" />Info
            </button>
            <div className="ml-auto flex items-center gap-1">
              <span className="min-w-0 max-w-[180px] truncate font-sans text-[11px] text-muted-foreground">
                {selectedNode?.name}
              </span>
              {selectedExt && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">{selectedExt.toUpperCase()}</Badge>
              )}
              <Button type="button" variant="ghost" size="icon-xs" className="size-5" onClick={() => { setSelectedPath(null); setPreviewContent(''); setFileInfo(null); }}>
                <X className="size-3" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {previewTab === 'preview' && (
              previewLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <RefreshCw className="mr-2 size-4 animate-spin" /> Lade Vorschau...
                </div>
              ) : isImage ? (
                <div className="flex items-center justify-center p-6">
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-2">
                    <p className="mb-2 text-center font-sans text-[11px] text-muted-foreground">
                      Bildvorschau (.{selectedExt}) — Binärdateien werden als Platzhalter angezeigt
                    </p>
                    <div className="flex h-48 w-full items-center justify-center rounded bg-muted/40">
                      <FileImage className="size-16 text-muted-foreground/30" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {/* Line numbers + syntax highlighted code */}
                  <div className="font-mono text-[12px] leading-[1.65]">
                    {highlightedLines.map((line, lineIdx) => (
                      <div key={lineIdx} className="flex hover:bg-accent/10">
                        <span className="w-10 shrink-0 select-none pr-3 text-right text-[11px] text-muted-foreground/40">
                          {lineIdx + 1}
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4">
                          {line.spans.map((span, si) => (
                            <span key={si} className={span.color}>{span.text}</span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {previewTab === 'diff' && (
              <div className="p-4">
                {diffLines.length > 0 ? (
                  <div className="rounded border border-border/40 font-mono text-[12px] leading-[1.65]">
                    {diffLines.map((line, i) => (
                      <div
                        key={i}
                        className={`flex px-2 ${
                          line.type === 'added' ? 'bg-emerald-50/80 dark:bg-emerald-950/30' :
                          line.type === 'removed' ? 'bg-red-50/80 dark:bg-red-950/30' : ''
                        }`}
                      >
                        <span className="w-6 shrink-0 select-none text-right text-[11px] text-muted-foreground/40">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                        </span>
                        <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words pl-2 ${
                          line.type === 'added' ? 'text-emerald-800 dark:text-emerald-300' :
                          line.type === 'removed' ? 'text-red-800 dark:text-red-300 line-through' : ''
                        }`}>
                          {line.text}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center">
                    <GitCompare className="mx-auto mb-3 size-10 text-muted-foreground/30" />
                    <h3 className="font-sans text-sm font-medium text-muted-foreground">Diff-Ansicht</h3>
                    <p className="mt-1 font-sans text-[12px] text-muted-foreground/70">
                      Wird automatisch angezeigt, wenn der Agent eine Datei bearbeitet.<br />
                      Vorher/Nachher-Vergleich mit zeilengenauen Hervorhebungen.
                    </p>
                    {previewContent && (
                      <Button
                        type="button" variant="outline" size="sm" className="mt-3"
                        onClick={() => {
                          setDiffOldContent(previewContent);
                          setDiffNewContent(previewContent + '\n// Beispiel-Änderung durch Agent');
                        }}
                      >
                        <Sparkles className="mr-1.5 size-3" /> Demo-Diff anzeigen
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {previewTab === 'info' && (
              <div className="p-4 space-y-3">
                <h3 className="font-sans text-sm font-medium">{selectedNode?.name ?? selectedPath}</h3>
                {fileInfo ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-sans text-[12px]">
                      <span className="text-muted-foreground">Pfad</span>
                      <span className="min-w-0 truncate text-foreground/90">{selectedPath}</span>
                      <span className="text-muted-foreground">Typ</span>
                      <span className="text-foreground/90">{selectedExt ? `.${selectedExt}` : 'Unbekannt'} ({fileInfo.kind})</span>
                      <span className="text-muted-foreground">Größe</span>
                      <span className="text-foreground/90">{formatSize(fileInfo.size)} ({fileInfo.size.toLocaleString('de-DE')} Bytes)</span>
                      <span className="text-muted-foreground">Erstellt</span>
                      <span className="text-foreground/90">{new Date(fileInfo.createdMs).toLocaleString('de-DE')}</span>
                      <span className="text-muted-foreground">Geändert</span>
                      <span className="text-foreground/90">{new Date(fileInfo.modifiedMs).toLocaleString('de-DE')} ({relativeTime(fileInfo.modifiedMs)})</span>
                    </div>
                    {selectedNode?.changeStatus && (
                      <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 p-2.5">
                        <span className={`inline-flex items-center gap-1.5 font-sans text-[11px] font-medium ${CHANGE_COLORS[selectedNode.changeStatus]}`}>
                          <span className={`size-2 rounded-full ${
                            selectedNode.changeStatus === 'created' ? 'bg-emerald-500' :
                            selectedNode.changeStatus === 'modified' ? 'bg-blue-500' :
                            selectedNode.changeStatus === 'deleted' ? 'bg-red-500' :
                            'bg-amber-500'
                          }`} />
                          {selectedNode.changeStatus === 'created' ? 'Neu erstellt' :
                           selectedNode.changeStatus === 'modified' ? 'Kürzlich geändert' :
                           selectedNode.changeStatus === 'deleted' ? 'Gelöscht' :
                           selectedNode.changeStatus === 'moved' ? 'Verschoben/Umbenannt' :
                           'Ausstehend'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="font-sans text-sm text-muted-foreground">Lade Datei-Info...</div>
                )}

                {/* Permission info for this path */}
                <div className="mt-4">
                  <h4 className="font-sans text-[11px] font-medium text-muted-foreground mb-1.5">Agent-Zugriffsrechte</h4>
                  <div className="space-y-1">
                    {FILE_PERMISSIONS.map((perm) => {
                      const colors = RISK_COLORS[perm.risk];
                      return (
                        <div key={perm.id} className="flex items-center gap-2 font-sans text-[11px]">
                          <span className={`size-1.5 rounded-full ${colors.dot}`} />
                          <span className="text-foreground/80">{perm.name}</span>
                          <span className={`ml-auto ${colors.text} opacity-70`}>{perm.risk}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* ════════════════════════ Context Menu ════════════════════════ */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12px] hover:bg-accent"
            onClick={() => {
              void openPreview(contextMenu.item);
              setContextMenu(null);
            }}
          >
            <Eye className="size-3.5 text-muted-foreground" /> Vorschau
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12px] hover:bg-accent"
            onClick={() => {
              setRenameTarget(contextMenu.item);
              setRenameValue(contextMenu.item.name);
              setRenameDialogOpen(true);
              setContextMenu(null);
            }}
          >
            <Pencil className="size-3.5 text-muted-foreground" /> Umbenennen
          </button>
          {contextMenu.item.kind === 'directory' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12px] hover:bg-accent"
              onClick={() => {
                navigateToDir(contextMenu.item.relativePath);
                setContextMenu(null);
              }}
            >
              <FolderOpen className="size-3.5 text-muted-foreground" /> Öffnen
            </button>
          )}
          {contextMenu.item.kind === 'file' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12px] hover:bg-accent"
              onClick={() => {
                if (previewContent) {
                  void navigator.clipboard.writeText(previewContent);
                }
                setContextMenu(null);
              }}
            >
              <Copy className="size-3.5 text-muted-foreground" /> Inhalt kopieren
            </button>
          )}
          <Separator className="my-1" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-sans text-[12px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={() => {
              setDeleteTarget(contextMenu.item);
              setDeleteDialogOpen(true);
              setContextMenu(null);
            }}
          >
            <Trash2 className="size-3.5" /> Löschen
          </button>
        </div>
      )}

      {/* ════════════════════════ Rename Dialog ════════════════════════ */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Umbenennen</DialogTitle>
            <DialogDescription>
              Neuen Namen für „{renameTarget?.name}" eingeben
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Neuer Name"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void handleRename(); }}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Abbrechen</DialogClose>
            <Button onClick={() => void handleRename()} disabled={renameLoading || !renameValue.trim()}>
              {renameLoading ? <RefreshCw className="mr-1.5 size-3 animate-spin" /> : <Check className="mr-1.5 size-3" />}
              Umbenennen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════ Delete Dialog ════════════════════════ */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 dark:text-red-400">Löschen bestätigen</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}" wird unwiderruflich gelöscht.
              {deleteTarget?.kind === 'directory' && ' Alle Inhalte dieses Ordners werden ebenfalls entfernt.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20 p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-600 dark:text-red-400" />
              <span className="font-sans text-[12px] text-red-800 dark:text-red-300">
                {deleteTarget?.kind === 'file' ? 'Dateiinhalt kann wiederhergestellt werden (Undo-Stack)' : 'Ordner können nicht vollständig wiederhergestellt werden'}
              </span>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Abbrechen</DialogClose>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleteLoading}>
              {deleteLoading ? <RefreshCw className="mr-1.5 size-3 animate-spin" /> : <Trash2 className="mr-1.5 size-3" />}
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════════════ Create File/Folder Dialog ════════════════════════ */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createKind === 'file' ? 'Neue Datei' : 'Neuer Ordner'}</DialogTitle>
            <DialogDescription>
              {createKind === 'file' ? 'Name der neuen Datei eingeben' : 'Name des neuen Ordners eingeben'}
              {currentRelPath && ` in ${currentRelPath}`}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={createKind === 'file' ? 'dateiname.txt' : 'ordnername'}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Abbrechen</DialogClose>
            <Button onClick={() => void handleCreate()} disabled={createLoading || !createName.trim()}>
              {createLoading ? <RefreshCw className="mr-1.5 size-3 animate-spin" /> : createKind === 'file' ? <FilePlus className="mr-1.5 size-3" /> : <FolderPlus className="mr-1.5 size-3" />}
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
