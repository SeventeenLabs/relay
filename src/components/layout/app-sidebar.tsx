import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoworkProject, MessageUsage } from '@/app-types';
import { formatCostUsd, formatTokenCount } from '@/lib/token-usage';
import {
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  HelpCircle,
  KeyRound,
  Link2,
  LogOut,
  MessageSquareText,
  Palette,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldAlert,
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

type AppPage = 'chat' | 'cowork' | 'project' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'approvals' | 'safety' | 'settings';
type SettingsSection = 'Profile' | 'Appearance' | 'System Prompt' | 'Gateway' | 'Connectors' | 'Account' | 'Privacy' | 'Developer';
type AppLanguage = 'en' | 'de';

type RecentSidebarItem = {
  id: string;
  label: string;
  sessionKey: string;
  kind: 'chat' | 'cowork';
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
  recentItems: RecentSidebarItem[];
  coworkProjects: CoworkProject[];
  activeCoworkProjectId: string;
  workingFolder: string;
  scheduledItems: ScheduledSidebarItem[];
  scheduledLoading: boolean;
  sessionUsage?: MessageUsage;
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

const coworkNavItems = [
  { label: 'Search', icon: Search },
] as const;

const projectFolderNavItems: { label: string; icon: typeof FolderOpen; page: AppPage }[] = [
  { label: 'Project Folder', icon: FolderOpen, page: 'local-files' },
  { label: 'Activity', icon: Zap, page: 'activity' },
  { label: 'Memory', icon: Brain, page: 'memory' },
  { label: 'Schedule', icon: CalendarClock, page: 'scheduled' },
  { label: 'Approvals', icon: ShieldAlert, page: 'approvals' },
  { label: 'Safety', icon: Shield, page: 'safety' },
];

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
  recentItems,
  coworkProjects,
  activeCoworkProjectId,
  workingFolder,
  scheduledItems,
  scheduledLoading,
  sessionUsage,
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
  const isWorkspacePage = ['project', 'files', 'local-files', 'activity', 'memory', 'scheduled', 'approvals', 'safety'].includes(activePage);
  const compact = !sidebarOpen;
  const navItems = coworkNavItems;
  const safeRecentItems = recentItems ?? [];
  const safeScheduledItems = scheduledItems ?? [];
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectStep, setCreateProjectStep] = useState<'chooser' | 'form'>('chooser');
  const [createProjectMode, setCreateProjectMode] = useState<'scratch' | 'existing'>('scratch');
  const [projectTitleDraft, setProjectTitleDraft] = useState('');
  const [projectFolderDraft, setProjectFolderDraft] = useState('');
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('');
  const [projectInstructionsDraft, setProjectInstructionsDraft] = useState('');
  const [projectFolderBrowsing, setProjectFolderBrowsing] = useState(false);
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [renameProjectId, setRenameProjectId] = useState('');
  const [renameProjectTitleDraft, setRenameProjectTitleDraft] = useState('');
  const [renameProjectDescriptionDraft, setRenameProjectDescriptionDraft] = useState('');
  const [renameProjectInstructionsDraft, setRenameProjectInstructionsDraft] = useState('');
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState('');
  const [expandedProjectId, setExpandedProjectId] = useState(activeCoworkProjectId);
  const languageMenuCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profilePopupPositionClass = compact
    ? 'bottom-0 left-[calc(100%+0.5rem)]'
    : 'left-0 right-0 bottom-[calc(100%+0.5rem)]';
  const profilePopupWidthClass = compact ? 'w-72' : 'w-auto';
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
      if (!profileMenuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) {
      setLanguageMenuOpen(false);
    }
  }, [profileMenuOpen]);

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

  const handleOpenCreateProject = () => {
    setCreateProjectStep('chooser');
    setCreateProjectMode('scratch');
    setProjectTitleDraft('');
    setProjectFolderDraft(workingFolder || '');
    setProjectDescriptionDraft('');
    setProjectInstructionsDraft('');
    setCreateProjectOpen(true);
  };

  const handleChooseCreateProjectMode = (mode: 'scratch' | 'existing') => {
    setCreateProjectMode(mode);
    setCreateProjectStep('form');
    if (mode === 'scratch') {
      setProjectFolderDraft(workingFolder || '');
    }
  };

  const handleConfirmCreateProject = () => {
    const trimmedTitle = projectTitleDraft.trim();
    const trimmedFolder = projectFolderDraft.trim();
    if (!trimmedTitle || !trimmedFolder) {
      return;
    }
    const trimmedDescription = projectDescriptionDraft.trim();
    const trimmedInstructions = projectInstructionsDraft.trim();
    onCreateCoworkProject(trimmedTitle, trimmedFolder, trimmedDescription || undefined, trimmedInstructions || undefined);
    setCreateProjectOpen(false);
    setProjectTitleDraft('');
    setProjectFolderDraft('');
    setProjectDescriptionDraft('');
    setProjectInstructionsDraft('');
  };

  const handleBrowseProjectFolder = async () => {
    setProjectFolderBrowsing(true);
    try {
      const selected = await onPickWorkingFolder();
      if (selected?.trim()) {
        setProjectFolderDraft(selected.trim());
      }
    } finally {
      setProjectFolderBrowsing(false);
    }
  };

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
      className="w-full rounded-none border-y-0 border-l-0 transition-all duration-200"
    >
      <SidebarContent>
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
                      title="New Run"
                      aria-label="Start a new run"
                      onClick={onStartNewTask}
                    >
                      <Plus data-icon="inline-start" />
                      {!compact && <span className="min-w-0 flex-1 truncate">New Run</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        type="button"
                        active={item.label === activeMenuItem}
                        aria-current={item.label === activeMenuItem ? 'page' : undefined}
                        onClick={() => {
                          if (item.label === 'Search') {
                            onOpenSearch();
                            return;
                          }
                          onSelectMenuItem(item.label);
                        }}
                        className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                        title={item.label}
                      >
                        <item.icon data-icon="inline-start" />
                        {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Project and global pages */}
            {!isChatView && (
              <>
                {!compact && (
                  <SidebarGroup className="mt-3">
                    <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            type="button"
                            active={activePage === 'files'}
                            aria-current={activePage === 'files' ? 'page' : undefined}
                            onClick={() => onSelectPage('files')}
                            className="gap-2 font-sans text-[13px]"
                            title="Workspace"
                          >
                            <HardDrive data-icon="inline-start" />
                            <span className="min-w-0 flex-1 truncate">Workspace</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
              </>
            )}

            {!compact && (
              <SidebarGroup className="mt-3 grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <SidebarGroupLabel>Recents</SidebarGroupLabel>
                <SidebarGroupContent className="min-h-0">
                  <ScrollArea className="h-full min-h-0">
                    <SidebarMenu className="pr-0.5">
                      {safeRecentItems.length === 0 ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton type="button" className="w-full justify-start truncate font-sans text-[12px] text-muted-foreground" disabled>
                            No recent runs yet
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        safeRecentItems.map((item) => (
                          <SidebarMenuItem key={item.id}>
                            <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                              <SidebarMenuButton
                                type="button"
                                active={
                                  item.kind === 'cowork' && item.sessionKey === activeCoworkSessionKey
                                }
                                aria-current={
                                  item.kind === 'cowork' && item.sessionKey === activeCoworkSessionKey
                                    ? 'page'
                                    : undefined
                                }
                                aria-label={`Open task ${item.label}`}
                                className="min-w-0 w-full gap-2 font-sans text-[12px]"
                                title={item.label}
                                onClick={() => onSelectRecentItem(item)}
                              >
                                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Task
                                </span>
                                <span className="block min-w-0 flex-1 truncate">{item.label}</span>
                              </SidebarMenuButton>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-6"
                                  title="Rename task"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onRenameRecentItem(item);
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-6 text-destructive hover:text-destructive"
                                  title="Delete task"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteRecentItem(item);
                                  }}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          </SidebarMenuItem>
                        ))
                      )}
                    </SidebarMenu>
                  </ScrollArea>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {!isChatView && !compact && (
              <SidebarGroup className="mt-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <div className="flex items-center justify-between px-2 pb-1">
                  <SidebarGroupLabel className="px-0">Projects</SidebarGroupLabel>
                  <Button type="button" size="icon" variant="ghost" className="size-7" onClick={handleOpenCreateProject} title="Add project">
                    <Plus className="size-4" />
                  </Button>
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
                        safeCoworkProjects.map((project) => (
                          <SidebarMenuItem key={project.id}>
                            <div className="group rounded-xl border border-border/70 bg-card/40 px-1 py-1">
                              <div className="flex items-center gap-1">
                                <SidebarMenuButton
                                  type="button"
                                  active={project.id === activeCoworkProjectId}
                                  aria-current={project.id === activeCoworkProjectId ? 'page' : undefined}
                                  data-testid={`project-select-${project.id}`}
                                  className="min-w-0 w-full gap-2 font-sans text-[12px]"
                                  title={`${project.name}${project.description ? ` - ${project.description}` : ''} (${project.workspaceFolder})`}
                                  onClick={() => {
                                    onSelectCoworkProject(project.id);
                                    onSelectPage('project');
                                    setExpandedProjectId((current) => (current === project.id ? '' : project.id));
                                  }}
                                >
                                  {expandedProjectId === project.id ? (
                                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="block min-w-0 flex-1 truncate">{project.name}</span>
                                </SidebarMenuButton>
                                <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-6"
                                    title={`New task in ${project.name}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSelectCoworkProject(project.id);
                                      onStartNewTask();
                                    }}
                                  >
                                    <Play className="size-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-6"
                                    data-testid={`project-rename-${project.id}`}
                                    title={`Rename project ${project.name}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleOpenRenameProject(project);
                                    }}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="size-6 text-destructive hover:text-destructive"
                                    data-testid={`project-delete-${project.id}`}
                                    title={`Delete project ${project.name}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleOpenDeleteProject(project);
                                    }}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>

                              {expandedProjectId === project.id && (
                                <div className="mt-1 border-l border-border/70 pl-2">
                                  <SidebarMenu>
                                    {projectFolderNavItems.map((item) => (
                                      <SidebarMenuItem key={`${project.id}-${item.page}`}>
                                        <SidebarMenuButton
                                          type="button"
                                          active={project.id === activeCoworkProjectId && activePage === item.page}
                                          aria-current={project.id === activeCoworkProjectId && activePage === item.page ? 'page' : undefined}
                                          className="gap-2 font-sans text-[12px]"
                                          title={`${item.label} Â· ${project.name}`}
                                          onClick={() => {
                                            onSelectCoworkProject(project.id);
                                            onSelectPage(item.page);
                                          }}
                                        >
                                          <item.icon data-icon="inline-start" className="size-3.5" />
                                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                        </SidebarMenuButton>
                                      </SidebarMenuItem>
                                    ))}
                                  </SidebarMenu>
                                </div>
                              )}
                            </div>
                          </SidebarMenuItem>
                        ))
                      )}
                    </SidebarMenu>
                  </ScrollArea>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}

        <Dialog
          open={createProjectOpen}
          onOpenChange={(nextOpen) => {
            setCreateProjectOpen(nextOpen);
            if (!nextOpen) {
              setCreateProjectStep('chooser');
              setCreateProjectMode('scratch');
              setProjectTitleDraft('');
              setProjectFolderDraft('');
              setProjectDescriptionDraft('');
              setProjectInstructionsDraft('');
            }
          }}
        >
          <DialogContent>
            {createProjectStep === 'chooser' ? (
              <>
                <DialogHeader>
                  <DialogTitle>Create a new project</DialogTitle>
                  <DialogDescription>
                    A dedicated place for ongoing work, where context builds over time.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
                    onClick={() => handleChooseCreateProjectMode('scratch')}
                    data-testid="create-project-mode-scratch"
                  >
                    <p className="font-sans text-sm font-medium text-foreground">Start from scratch</p>
                    <p className="font-sans text-xs text-muted-foreground">Set up a new folder with instructions and files.</p>
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
                    onClick={() => handleChooseCreateProjectMode('existing')}
                    data-testid="create-project-mode-existing"
                  >
                    <p className="font-sans text-sm font-medium text-foreground">Use an existing folder</p>
                    <p className="font-sans text-xs text-muted-foreground">Bind an existing local folder as your project root.</p>
                  </button>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Start a new project</DialogTitle>
                  <DialogDescription>
                    Configure name, instructions, and location for this project workspace.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <Input
                    value={projectTitleDraft}
                    onChange={(event) => setProjectTitleDraft(event.target.value)}
                    placeholder="Project name"
                    autoFocus
                  />
                  <Textarea
                    value={projectDescriptionDraft}
                    onChange={(event) => setProjectDescriptionDraft(event.target.value)}
                    placeholder="Project description (what this project is about)"
                    rows={2}
                    className="font-sans text-sm"
                  />
                  <Textarea
                    value={projectInstructionsDraft}
                    onChange={(event) => setProjectInstructionsDraft(event.target.value)}
                    placeholder="Project instructions for cowork runs (role, tone, constraints, output format)"
                    rows={4}
                    className="font-sans text-sm"
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                    <Input
                      value={projectFolderDraft}
                      onChange={(event) => setProjectFolderDraft(event.target.value)}
                      placeholder="Choose project location"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => setProjectFolderDraft(workingFolder || '')}>
                      Use current
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleBrowseProjectFolder()}
                      disabled={projectFolderBrowsing}
                    >
                      {projectFolderBrowsing ? 'Browsing...' : 'Browse'}
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateProjectStep('chooser')}
                  >
                    Back
                  </Button>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button
                    type="button"
                    onClick={handleConfirmCreateProject}
                    disabled={!projectTitleDraft.trim() || !projectFolderDraft.trim()}
                  >
                    Create
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

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
          {profileMenuOpen ? (
            <div className={`absolute z-50 ${profilePopupWidthClass} rounded-2xl border border-border bg-popover p-1.5 shadow-2xl backdrop-blur-sm ${profilePopupPositionClass}`}>
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
                {languageMenuOpen ? (
                  <div
                    className="absolute top-0 left-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl backdrop-blur-sm"
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
                  </div>
                ) : null}
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
                  onLogout();
                }}
              >
                <LogOut className="size-4 text-muted-foreground" />
                <span>{guestMode ? t('Exit local mode', 'Abmelden') : t('Sign out', 'Abmelden')}</span>
              </button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setProfileMenuOpen((open) => !open)}
            className={`h-9 border-0 bg-transparent shadow-none gap-2 rounded-xl font-sans text-[13px] ${compact ? 'w-9 px-0 justify-center' : 'w-full justify-start'}`}
            aria-label="Open settings menu"
            aria-expanded={profileMenuOpen}
            title="Settings"
          >
            <Settings className="size-4" />
            {!compact && <span>Settings</span>}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

