import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CoworkProject, MessageUsage } from '@/app-types';
import { formatCostUsd, formatTokenCount } from '@/lib/token-usage';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Download,
  FolderOpen,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  Play,
  Plus,
  SlidersHorizontal,
  SquarePen,
  Search,
  Settings,
  Shield,
  Trash2,
  User,
  Wifi,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

type AppPage = 'chat' | 'cowork' | 'project' | 'settings';
type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';
type AppLanguage = 'en' | 'de';

type RecentSidebarItem = {
  id: string;
  label: string;
  sessionKey: string;
  kind: 'chat' | 'cowork';
  updatedAt?: number;
};

type ScheduledSidebarItem = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
};

type AppSidebarProps = {
  sidebarOpen: boolean;
  activeMenuItem: string;
  activePage: AppPage;
  activeSessionKey: string;
  activeCoworkSessionKey: string;
  userEmail: string;
  guestMode: boolean;
  language: AppLanguage;
  settingsSection: SettingsSection;
  chatRecentItems: RecentSidebarItem[];
  projectRecentItemsByProjectId: Record<string, RecentSidebarItem[]>;
  coworkProjects: CoworkProject[];
  activeCoworkProjectId: string;
  workingFolder: string;
  scheduledItems: ScheduledSidebarItem[];
  scheduledLoading: boolean;
  sessionUsage?: MessageUsage;
  gatewayConnected: boolean;
  onSelectRecentItem: (item: RecentSidebarItem) => void;
  onRenameRecentItem: (item: RecentSidebarItem) => void;
  onDeleteRecentItem: (item: RecentSidebarItem) => void;
  onSelectCoworkProject: (projectId: string) => void;
  onCreateCoworkProject: (name: string, workspaceFolder: string, description?: string, instructions?: string) => void;
  onRenameCoworkProject: (projectId: string, name: string, description?: string, instructions?: string) => void;
  onDeleteCoworkProject: (projectId: string) => void;
  onPickWorkingFolder: () => Promise<string | undefined>;
  onStartNewChat: () => void;
  onStartNewTask: () => void;
  onSelectMenuItem: (item: string) => void;
  onSelectPage: (page: AppPage) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSettingsSectionChange: (section: SettingsSection) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
};

const settingsNavItems: { label: SettingsSection; icon: typeof User }[] = [
  { label: 'Profile', icon: User },
  { label: 'Appearance', icon: Palette },
  { label: 'System Prompt', icon: MessageSquareText },
  { label: 'Gateway', icon: Wifi },
  { label: 'Connectors', icon: Link2 },
  { label: 'Account', icon: KeyRound },
  { label: 'Privacy', icon: Shield },
  { label: 'Developer', icon: Code2 },
];

const sectionLabels: Record<SettingsSection, { en: string; de: string }> = {
  Profile: { en: 'Profile', de: 'Profil' },
  Appearance: { en: 'Appearance', de: 'Darstellung' },
  'System Prompt': { en: 'System Prompt', de: 'System-Prompt' },
  Gateway: { en: 'Gateway', de: 'Gateway' },
  Connectors: { en: 'Connectors', de: 'Konnektoren' },
  Account: { en: 'Account', de: 'Konto' },
  Privacy: { en: 'Privacy', de: 'Datenschutz' },
  Developer: { en: 'Developer', de: 'Entwickler' },
};

export function AppSidebar({
  sidebarOpen,
  activeMenuItem,
  activePage,
  activeSessionKey,
  activeCoworkSessionKey,
  userEmail,
  guestMode,
  language,
  settingsSection,
  chatRecentItems,
  projectRecentItemsByProjectId,
  coworkProjects,
  activeCoworkProjectId,
  workingFolder,
  scheduledItems,
  scheduledLoading,
  sessionUsage,
  gatewayConnected,
  onSelectRecentItem,
  onRenameRecentItem,
  onDeleteRecentItem,
  onSelectCoworkProject,
  onCreateCoworkProject,
  onRenameCoworkProject,
  onDeleteCoworkProject,
  onPickWorkingFolder,
  onStartNewChat,
  onStartNewTask,
  onSelectMenuItem,
  onSelectPage,
  onOpenSearch,
  onOpenSettings,
  onSettingsSectionChange,
  onLanguageChange,
  onLogout,
}: AppSidebarProps) {
  const t = (en: string, de: string) => (language === 'de' ? de : en);
  const isChatView = false;
  const isSettingsView = activePage === 'settings';
  const isWorkspacePage = ['cowork', 'project'].includes(activePage);
  const compact = !sidebarOpen;
  const safeChatRecentItems = chatRecentItems ?? [];
  const safeScheduledItems = scheduledItems ?? [];
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [projectCreateMenuOpen, setProjectCreateMenuOpen] = useState(false);
  const [projectOptionsMenuOpen, setProjectOptionsMenuOpen] = useState(false);
  const projectCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const projectOptionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectCreateTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectRowTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [projectOptionsMenuPosition, setProjectOptionsMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [projectCreateMenuPosition, setProjectCreateMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [projectRowMenuPosition, setProjectRowMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [profileMenuPosition, setProfileMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [renameProjectId, setRenameProjectId] = useState('');
  const [renameProjectTitleDraft, setRenameProjectTitleDraft] = useState('');
  const [renameProjectDescriptionDraft, setRenameProjectDescriptionDraft] = useState('');
  const [renameProjectInstructionsDraft, setRenameProjectInstructionsDraft] = useState('');
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState('');
  const [projectRowMenuId, setProjectRowMenuId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState(activeCoworkProjectId);
  const languageMenuCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const userInitials = useMemo(() => {
    const trimmed = userEmail.split('(')[0]?.trim() || userEmail.trim();
    const parts = trimmed.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    if (parts.length === 0) {
      return 'U';
    }
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  }, [userEmail]);
  const profileMenuItemClass =
    'group flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color,box-shadow] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const profileMenuIconClass = 'size-4 text-muted-foreground transition-colors group-hover:text-foreground/80';
  const languageOptions: { value: AppLanguage; label: string }[] = [
    { value: 'en', label: 'English (United States)' },
    { value: 'de', label: 'Deutsch (Deutschland)' },
  ];
  const formatRelativeAge = (updatedAt?: number) => {
    if (!updatedAt) return '';
    const deltaMs = Math.max(0, Date.now() - updatedAt);
    const hours = Math.max(1, Math.floor(deltaMs / 3_600_000));
    if (hours < 24) return language === 'de' ? `${hours} Std.` : `${hours}h`;
    const days = Math.max(1, Math.floor(hours / 24));
    if (days < 7) return language === 'de' ? `${days} Tag(e)` : `${days}d`;
    const weeks = Math.max(1, Math.floor(days / 7));
    return language === 'de' ? `${weeks} W` : `${weeks}w`;
  };

  const safeCoworkProjects = coworkProjects ?? [];
  const renameProjectTarget = safeCoworkProjects.find((project) => project.id === renameProjectId) ?? null;
  const deleteProjectTarget = safeCoworkProjects.find((project) => project.id === deleteProjectId) ?? null;

  useEffect(() => {
    setExpandedProjectId((current) => {
      if (!safeCoworkProjects.some((project) => project.id === current)) {
        return activeCoworkProjectId || safeCoworkProjects[0]?.id || '';
      }
      return current;
    });
  }, [activeCoworkProjectId, safeCoworkProjects]);

  useEffect(() => {
    if (!profileMenuOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-profile-menu-portal="true"]')) {
        return;
      }
      if (!profileMenuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
        setLanguageMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) {
      setLanguageMenuOpen(false);
      setProfileMenuPosition(null);
    }
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!projectRowMenuId) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-project-row-menu="true"]')) {
        return;
      }
      setProjectRowMenuId(null);
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [projectRowMenuId]);

  useEffect(() => {
    return () => {
      if (languageMenuCloseTimerRef.current) {
        clearTimeout(languageMenuCloseTimerRef.current);
      }
    };
  }, []);

  const openLanguageMenu = () => {
    if (languageMenuCloseTimerRef.current) {
      clearTimeout(languageMenuCloseTimerRef.current);
      languageMenuCloseTimerRef.current = null;
    }
    setLanguageMenuOpen(true);
  };

  const scheduleLanguageMenuClose = () => {
    if (languageMenuCloseTimerRef.current) {
      clearTimeout(languageMenuCloseTimerRef.current);
    }
    languageMenuCloseTimerRef.current = window.setTimeout(() => {
      setLanguageMenuOpen(false);
      languageMenuCloseTimerRef.current = null;
    }, 130);
  };

  const toProjectNameFromFolder = (folderPath: string) => {
    const normalized = folderPath.replace(/[\\/]+$/, '');
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || `project-${Date.now()}`;
  };

  const handleCreateProjectFromExistingFolder = async () => {
    setProjectCreateMenuOpen(false);
    const selected = await onPickWorkingFolder();
    const folder = selected?.trim();
    if (!folder) {
      return;
    }
    onCreateCoworkProject(toProjectNameFromFolder(folder), folder);
  };

  const handleCreateProjectFromScratch = async () => {
    setProjectCreateMenuOpen(false);
    const selected = await onPickWorkingFolder();
    const folder = selected?.trim();
    if (!folder) {
      return;
    }
    onCreateCoworkProject('New Project', folder);
  };

  const getFixedDropdownPosition = (trigger: HTMLElement, menuWidth: number, gap = 4) => {
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(rect.bottom + gap, window.innerHeight - 8));
    return { top, left };
  };

  const updateProjectOptionsMenuPosition = () => {
    if (!projectOptionsTriggerRef.current) {
      setProjectOptionsMenuPosition(null);
      return;
    }
    setProjectOptionsMenuPosition(getFixedDropdownPosition(projectOptionsTriggerRef.current, 176));
  };

  const updateProjectCreateMenuPosition = () => {
    if (!projectCreateTriggerRef.current) {
      setProjectCreateMenuPosition(null);
      return;
    }
    setProjectCreateMenuPosition(getFixedDropdownPosition(projectCreateTriggerRef.current, 224));
  };

  const updateProjectRowMenuPosition = (projectId: string) => {
    const trigger = projectRowTriggerRefs.current[projectId];
    if (!trigger) {
      setProjectRowMenuPosition(null);
      return;
    }
    setProjectRowMenuPosition(getFixedDropdownPosition(trigger, 160));
  };

  const updateProfileMenuPosition = () => {
    if (!profileTriggerRef.current) {
      setProfileMenuPosition(null);
      return;
    }
    const rect = profileTriggerRef.current.getBoundingClientRect();
    const width = 288;
    const left = compact
      ? Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8))
      : Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = compact
      ? Math.max(8, Math.min(rect.bottom - 288, window.innerHeight - 320))
      : Math.max(8, Math.min(rect.top - 320 - 8, window.innerHeight - 320));
    setProfileMenuPosition({ top, left });
  };

  useEffect(() => {
    if (!projectCreateMenuOpen && !projectOptionsMenuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!projectCreateMenuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (target?.closest('[data-project-header-menu="true"]')) {
        return;
      }
      if (!projectCreateMenuRef.current.contains(event.target)) {
        setProjectCreateMenuOpen(false);
        setProjectOptionsMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [projectCreateMenuOpen, projectOptionsMenuOpen]);

  useEffect(() => {
    if (!projectOptionsMenuOpen) {
      return;
    }
    const syncPosition = () => updateProjectOptionsMenuPosition();
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [projectOptionsMenuOpen]);

  useEffect(() => {
    if (!projectCreateMenuOpen) {
      return;
    }
    const syncPosition = () => updateProjectCreateMenuPosition();
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [projectCreateMenuOpen]);

  useEffect(() => {
    if (!projectRowMenuId) {
      return;
    }
    const syncPosition = () => updateProjectRowMenuPosition(projectRowMenuId);
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [projectRowMenuId]);

  useEffect(() => {
    if (!profileMenuOpen) {
      return;
    }
    const syncPosition = () => updateProfileMenuPosition();
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [profileMenuOpen, compact]);

  useEffect(() => {
    if (!projectOptionsMenuOpen) {
      setProjectOptionsMenuPosition(null);
    }
    if (!projectCreateMenuOpen) {
      setProjectCreateMenuPosition(null);
    }
    if (!projectRowMenuId) {
      setProjectRowMenuPosition(null);
    }
  }, [projectOptionsMenuOpen, projectCreateMenuOpen, projectRowMenuId]);

  const handleOpenRenameProject = (project: CoworkProject) => {
    setRenameProjectId(project.id);
    setRenameProjectTitleDraft(project.name);
    setRenameProjectDescriptionDraft(project.description ?? '');
    setRenameProjectInstructionsDraft(project.instructions ?? '');
    setRenameProjectOpen(true);
  };

  const handleConfirmRenameProject = () => {
    const trimmedId = renameProjectId.trim();
    const trimmedTitle = renameProjectTitleDraft.trim();
    if (!trimmedId || !trimmedTitle) {
      return;
    }

    const trimmedDescription = renameProjectDescriptionDraft.trim();
    const trimmedInstructions = renameProjectInstructionsDraft.trim();
    onRenameCoworkProject(trimmedId, trimmedTitle, trimmedDescription || undefined, trimmedInstructions || undefined);
    setRenameProjectOpen(false);
    setRenameProjectId('');
    setRenameProjectTitleDraft('');
    setRenameProjectDescriptionDraft('');
    setRenameProjectInstructionsDraft('');
  };

  const handleOpenDeleteProject = (project: CoworkProject) => {
    setDeleteProjectId(project.id);
    setDeleteProjectOpen(true);
  };

  const handleConfirmDeleteProject = () => {
    const trimmedId = deleteProjectId.trim();
    if (!trimmedId) {
      return;
    }

    onDeleteCoworkProject(trimmedId);
    setDeleteProjectOpen(false);
    setDeleteProjectId('');
  };

  return (
    <Sidebar
      className="relative z-[900] isolate w-full overflow-visible border-y-0 border-l-0 transition-all duration-200 [&_button]:border-0 [&_button]:shadow-none"
    >
      <SidebarContent className="relative overflow-visible">
        {isSettingsView ? (
          /* â”€â”€ Settings navigation â”€â”€ */
          <>
            <SidebarGroup>
              {!compact && <SidebarGroupLabel>{t('Settings', 'Einstellungen')}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsNavItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        type="button"
                        active={settingsSection === item.label}
                        aria-current={settingsSection === item.label ? 'page' : undefined}
                        onClick={() => onSettingsSectionChange(item.label)}
                        className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                        title={sectionLabels[item.label][language]}
                      >
                        <item.icon data-icon="inline-start" />
                        {!compact && <span className="min-w-0 flex-1 truncate">{sectionLabels[item.label][language]}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          /* â”€â”€ Regular chat/cowork navigation â”€â”€ */
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu aria-label="Primary workspace menu">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      type="button"
                      className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                      title="New Chat"
                      aria-label="Start a new chat"
                      onClick={activePage === 'cowork' ? onStartNewTask : onStartNewChat}
                    >
                      <Plus data-icon="inline-start" />
                      {!compact && <span className="min-w-0 flex-1 truncate">Neuer Chat</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {!isChatView && !compact && (
              <SidebarGroup className="mt-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-visible">
                <div className="group relative z-20 flex items-center justify-between px-2 pb-1">
                  <SidebarGroupLabel className="px-0">Projects</SidebarGroupLabel>
                  <div ref={projectCreateMenuRef} className="relative z-30 flex items-center gap-0.5 overflow-visible opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      ref={projectOptionsTriggerRef}
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 border-0 bg-transparent shadow-none hover:bg-muted"
                      title="Project options"
                      onClick={() => {
                        setProjectOptionsMenuOpen((current) => {
                          const next = !current;
                          if (next) {
                            updateProjectOptionsMenuPosition();
                          }
                          return next;
                        });
                        setProjectCreateMenuOpen(false);
                      }}
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </Button>
                    {projectOptionsMenuOpen && projectOptionsMenuPosition && typeof document !== 'undefined'
                      ? createPortal(
                        <div
                          data-project-header-menu="true"
                          className="fixed z-[2200] w-44 rounded-2xl border border-border bg-popover p-1.5 shadow-xl"
                          style={{ top: projectOptionsMenuPosition.top, left: projectOptionsMenuPosition.left }}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-sans text-[13px] text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setProjectOptionsMenuOpen(false);
                              if (activeCoworkProjectId) {
                                const activeProject = safeCoworkProjects.find((project) => project.id === activeCoworkProjectId);
                                if (activeProject) {
                                  handleOpenDeleteProject(activeProject);
                                }
                              }
                            }}
                            disabled={!activeCoworkProjectId}
                          >
                            <Trash2 className="size-4" />
                            <span>Aktives Projekt löschen</span>
                          </button>
                        </div>,
                        document.body,
                      )
                      : null}
                    <Button
                      ref={projectCreateTriggerRef}
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 border-0 bg-transparent shadow-none hover:bg-muted"
                      onClick={() => {
                        setProjectCreateMenuOpen((current) => {
                          const next = !current;
                          if (next) {
                            updateProjectCreateMenuPosition();
                          }
                          return next;
                        });
                        setProjectOptionsMenuOpen(false);
                      }}
                      title="Add project"
                    >
                      <Plus className="size-4" />
                    </Button>
                    {projectCreateMenuOpen && projectCreateMenuPosition && typeof document !== 'undefined'
                      ? createPortal(
                        <div
                          data-project-header-menu="true"
                          className="fixed z-[2200] w-56 rounded-2xl border border-border bg-popover p-1.5 shadow-xl"
                          style={{ top: projectCreateMenuPosition.top, left: projectCreateMenuPosition.left }}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-sans text-[13px] hover:bg-muted"
                            data-testid="create-project-mode-new"
                            onClick={() => void handleCreateProjectFromScratch()}
                          >
                            <FolderOpen className="size-4 text-muted-foreground" />
                            <span>Von vorne anfangen</span>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-sans text-[13px] hover:bg-muted"
                            data-testid="create-project-mode-existing"
                            onClick={() => void handleCreateProjectFromExistingFolder()}
                          >
                            <FolderOpen className="size-4 text-muted-foreground" />
                            <span>Vorhandenen Ordner verwenden</span>
                          </button>
                        </div>,
                        document.body,
                      )
                      : null}
                  </div>
                </div>
                <SidebarGroupContent className="min-h-0">
                  <ScrollArea className="h-full min-h-0">
                    <SidebarMenu className="pr-0.5">
                      {safeCoworkProjects.length === 0 ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton type="button" className="w-full justify-start truncate font-sans text-[12px] text-muted-foreground" disabled>
                            No projects yet
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        safeCoworkProjects.map((project) => {
                          const projectChats = (projectRecentItemsByProjectId[project.id] ?? []).slice(0, 6);
                          const hasProjectChats = projectChats.length > 0;
                          const isExpanded = expandedProjectId === project.id;
                          return (
                          <SidebarMenuItem key={project.id}>
                            <div className="group relative rounded-xl px-1 py-1">
                              <div className="flex items-center gap-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted">
                                <SidebarMenuButton
                                  type="button"
                                  active={false}
                                  aria-current={project.id === activeCoworkProjectId ? 'page' : undefined}
                                  data-testid={`project-select-${project.id}`}
                                  className="min-w-0 w-full gap-2 rounded-lg px-2 py-1.5 font-sans text-[12px] text-foreground/95 transition-colors hover:bg-transparent data-[active=true]:bg-transparent"
                                  onClick={() => {
                                    onSelectCoworkProject(project.id);
                                    onSelectPage('cowork');
                                    setExpandedProjectId((current) => (current === project.id ? '' : project.id));
                                  }}
                                >
                                  <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="block min-w-0 flex-1 truncate">{project.name}</span>
                                </SidebarMenuButton>
                                <div data-project-row-menu="true" className="relative flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-6 hover:bg-transparent"
                                    ref={(element) => {
                                      projectRowTriggerRefs.current[project.id] = element;
                                    }}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setProjectRowMenuId((current) => {
                                        const next = current === project.id ? null : project.id;
                                        if (next) {
                                          updateProjectRowMenuPosition(next);
                                        }
                                        return next;
                                      });
                                    }}
                                  >
                                    <MoreHorizontal className="size-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-6 hover:bg-transparent"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSelectCoworkProject(project.id);
                                      onStartNewTask();
                                    }}
                                  >
                                    <SquarePen className="size-3.5" />
                                  </Button>
                                  {projectRowMenuId === project.id && projectRowMenuPosition && typeof document !== 'undefined'
                                    ? createPortal(
                                      <div
                                        data-project-row-menu="true"
                                        className="fixed z-[2200] w-40 rounded-xl border border-border bg-popover p-1 shadow-lg"
                                        style={{ top: projectRowMenuPosition.top, left: projectRowMenuPosition.left }}
                                      >
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
                                          data-testid={`project-rename-${project.id}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setProjectRowMenuId(null);
                                            handleOpenRenameProject(project);
                                          }}
                                        >
                                          <Pencil className="size-3.5" />
                                          Rename
                                        </button>
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                                          data-testid={`project-delete-${project.id}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setProjectRowMenuId(null);
                                            handleOpenDeleteProject(project);
                                          }}
                                        >
                                          <Trash2 className="size-3.5" />
                                          Delete
                                        </button>
                                      </div>,
                                      document.body,
                                    )
                                    : null}
                                </div>
                              </div>

                              {isExpanded ? (
                                <div className="mt-1 pb-1">
                                  {hasProjectChats ? (
                                    <div className="grid gap-0.5">
                                      {projectChats.map((item) => {
                                        const isActiveCoworkItem =
                                          activePage === 'cowork'
                                          && item.sessionKey.trim().length > 0
                                          && item.sessionKey === activeCoworkSessionKey;
                                        return (
                                        <div key={item.id} className="group/item relative">
                                          <button
                                            type="button"
                                            className={`flex w-full items-center justify-between rounded-xl py-1.5 pl-8 pr-2 text-left font-sans text-[12px] transition-colors ${
                                              isActiveCoworkItem ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted'
                                            }`}
                                            onClick={() => onSelectRecentItem(item)}
                                          >
                                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                            <span className="ml-2 flex shrink-0 items-center gap-2">
                                              {typeof item.updatedAt === 'number' ? (
                                                <span className="text-[11px] text-muted-foreground">{formatRelativeAge(item.updatedAt)}</span>
                                              ) : null}
                                              {isActiveCoworkItem ? <span className="h-2 w-2 rounded-full border border-border bg-muted-foreground/40" /> : null}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            aria-label="Pin chat"
                                            title="Pin chat"
                                            className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover/item:opacity-100 focus-visible:opacity-100"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                            }}
                                          >
                                            <Pin className="size-3" />
                                          </button>
                                        </div>
                                      )})}
                                    </div>
                                  ) : (
                                    <div className="rounded-xl py-1.5 pl-8 pr-2 text-left font-sans text-[12px] text-muted-foreground">
                                      No chats
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </SidebarMenuItem>
                        )})
                      )}
                    </SidebarMenu>
                  </ScrollArea>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {!compact && (
              <SidebarGroup className="mt-3 grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <div className="group flex items-center justify-between px-2 pb-1">
                  <SidebarGroupLabel className="px-0">Chats</SidebarGroupLabel>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 border-0 bg-transparent shadow-none hover:bg-muted"
                      title="Filter chats"
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 border-0 bg-transparent shadow-none hover:bg-muted"
                      title="New chat"
                      onClick={onStartNewChat}
                    >
                      <SquarePen className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <SidebarGroupContent className="min-h-0">
                  <ScrollArea className="h-full min-h-0">
                    <SidebarMenu className="pr-0.5">
                      {safeChatRecentItems.length === 0 ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton type="button" className="w-full justify-start truncate font-sans text-[12px] text-muted-foreground" disabled>
                            No chats yet
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        safeChatRecentItems.map((item) => {
                          const isActiveChatItem =
                            activePage === 'chat'
                            && item.sessionKey.trim().length > 0
                            && item.sessionKey === activeSessionKey;
                          return (
                          <SidebarMenuItem key={item.id}>
                            <button
                              type="button"
                              className={`flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left font-sans text-[12px] transition-colors ${
                                isActiveChatItem ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted'
                              }`}
                              onClick={() => onSelectRecentItem(item)}
                            >
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {typeof item.updatedAt === 'number' ? (
                                <span className="shrink-0 pl-2 text-[11px] text-muted-foreground">{formatRelativeAge(item.updatedAt)}</span>
                              ) : null}
                            </button>
                          </SidebarMenuItem>
                        )})
                      )}
                    </SidebarMenu>
                  </ScrollArea>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}

        <Dialog
          open={renameProjectOpen}
          onOpenChange={(nextOpen) => {
            setRenameProjectOpen(nextOpen);
            if (!nextOpen) {
              setRenameProjectId('');
              setRenameProjectTitleDraft('');
              setRenameProjectDescriptionDraft('');
              setRenameProjectInstructionsDraft('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>
                Update the project title and optional description. The folder mapping stays unchanged.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Input
                value={renameProjectTitleDraft}
                onChange={(event) => setRenameProjectTitleDraft(event.target.value)}
                placeholder="Project title"
                autoFocus
              />
              <Input
                value={renameProjectDescriptionDraft}
                onChange={(event) => setRenameProjectDescriptionDraft(event.target.value)}
                placeholder="Description (optional)"
              />
              <Textarea
                value={renameProjectInstructionsDraft}
                onChange={(event) => setRenameProjectInstructionsDraft(event.target.value)}
                placeholder="Instructions for cowork runs (optional)"
                rows={4}
                className="font-sans text-sm"
              />
              {renameProjectTarget && (
                <p className="font-sans text-[11px] text-muted-foreground">
                  Folder: {renameProjectTarget.workspaceFolder}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                type="button"
                onClick={handleConfirmRenameProject}
                disabled={!renameProjectTitleDraft.trim()}
                data-testid="rename-project-confirm"
              >
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deleteProjectOpen}
          onOpenChange={(nextOpen) => {
            setDeleteProjectOpen(nextOpen);
            if (!nextOpen) {
              setDeleteProjectId('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete project</DialogTitle>
              <DialogDescription>
                Remove this project from Relay. This does not delete any local files in the folder.
              </DialogDescription>
            </DialogHeader>
            <p className="font-sans text-[13px] text-foreground/90">
              {deleteProjectTarget ? `Project: ${deleteProjectTarget.name}` : 'Select a project to delete.'}
            </p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDeleteProject}
                disabled={!deleteProjectTarget}
                data-testid="delete-project-confirm"
              >
                Delete project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarContent>
      <SidebarFooter className="border-0 p-0">
        <div className={`relative px-2 py-2 ${compact ? 'flex justify-center' : ''}`} ref={profileMenuRef}>
          {profileMenuOpen && profileMenuPosition && typeof document !== 'undefined'
            ? createPortal(
              <div
                data-profile-menu-portal="true"
                className="fixed z-[2200] w-72 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl backdrop-blur-sm"
                style={{ top: profileMenuPosition.top, left: profileMenuPosition.left }}
              >
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-muted-foreground">
                  <div className="flex size-5 items-center justify-center rounded-full bg-muted">
                    <User className="size-3.5" />
                  </div>
                  <span className="truncate">{userEmail}</span>
                </div>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color] hover:bg-muted hover:text-foreground"
                >
                  <Settings className="size-4 text-muted-foreground" />
                  <span>{t('Personal account', 'Persönliches Konto')}</span>
                </button>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl bg-muted px-2.5 py-2 text-left text-[13px] font-medium text-foreground/90 transition-[background-color,color] hover:bg-muted/80"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="size-4 text-foreground" />
                    <span>{t('Get an upgrade for higher limits', 'Hol dir ein Upgrade für höhere Limits')}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <Separator className="my-1.5" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color] hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    onOpenSettings();
                    setProfileMenuOpen(false);
                    setLanguageMenuOpen(false);
                  }}
                >
                  <Settings className="size-4 text-muted-foreground" />
                  <span>{t('Settings', 'Einstellungen')}</span>
                </button>
                <div
                  className="relative"
                  onMouseEnter={openLanguageMenu}
                  onMouseLeave={scheduleLanguageMenuClose}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color] hover:bg-muted hover:text-foreground"
                    aria-expanded={languageMenuOpen}
                    aria-haspopup="menu"
                    onFocus={openLanguageMenu}
                    onClick={() => setLanguageMenuOpen((open) => !open)}
                  >
                    <span className="flex items-center gap-2">
                      <Globe className="size-4 text-muted-foreground" />
                      {t('Language', 'Sprache')}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color] hover:bg-muted hover:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle className="size-4 text-muted-foreground" />
                    {t('Remaining rate limits', 'Verbleibende Ratelimits')}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-foreground/80 transition-[background-color,color] hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setLanguageMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut className="size-4 text-muted-foreground" />
                  <span>{guestMode ? t('Exit local mode', 'Abmelden') : t('Sign out', 'Abmelden')}</span>
                </button>
              </div>,
              document.body,
            )
            : null}
          {profileMenuOpen && languageMenuOpen && profileMenuPosition && typeof document !== 'undefined'
            ? createPortal(
              <div
                data-profile-menu-portal="true"
                className="fixed z-[2200] w-64 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl backdrop-blur-sm"
                style={{ top: profileMenuPosition.top + 200, left: profileMenuPosition.left + 292 }}
                role="menu"
                onMouseEnter={openLanguageMenu}
                onMouseLeave={scheduleLanguageMenuClose}
              >
                <div className="grid gap-0.5">
                  {languageOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition-[background-color,color] hover:bg-muted hover:text-foreground ${
                        language === option.value ? 'bg-muted text-foreground' : 'text-foreground/80'
                      }`}
                      onClick={() => {
                        onLanguageChange(option.value);
                        setLanguageMenuOpen(false);
                        setProfileMenuOpen(false);
                      }}
                    >
                      <span>{option.label}</span>
                      {language === option.value ? <Check className="size-4 text-foreground/80" /> : null}
                    </button>
                  ))}
                </div>
              </div>,
              document.body,
            )
            : null}
          <div className={`flex items-center gap-2 ${compact ? 'justify-center' : ''}`}>
            <Button
              type="button"
              variant="ghost"
              ref={profileTriggerRef}
              onClick={() => {
                setProfileMenuOpen((open) => {
                  const next = !open;
                  if (next) {
                    updateProfileMenuPosition();
                  }
                  return next;
                });
              }}
              className={`footer-settings-trigger h-9 border-0 bg-muted/85 shadow-none gap-2 rounded-xl font-sans text-[13px] text-foreground transition-colors ${compact ? 'w-9 px-0 justify-center' : 'flex-1 justify-start px-2.5'}`}
              aria-label="Open settings menu"
              aria-expanded={profileMenuOpen}
              title="Settings"
            >
              <Settings className="size-4 text-muted-foreground" />
              {!compact && <span>{t('Settings', 'Einstellungen')}</span>}
            </Button>
            {null}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
