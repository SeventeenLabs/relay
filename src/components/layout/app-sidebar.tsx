import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
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
  Palette,
  Plus,
  Search,
  Settings,
  Shield,
  User,
  Wifi,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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

type AppPage = 'chat' | 'cowork' | 'files' | 'activity' | 'memory' | 'scheduled' | 'safety' | 'settings';
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
  gatewayConnected: boolean;
  language: AppLanguage;
  settingsSection: SettingsSection;
  recentItems: RecentSidebarItem[];
  scheduledItems: ScheduledSidebarItem[];
  scheduledLoading: boolean;
  onSelectRecentItem: (item: RecentSidebarItem) => void;
  onStartNewChat: () => void;
  onStartNewTask: () => void;
  onSelectMenuItem: (item: string) => void;
  onSelectPage: (page: AppPage) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onSettingsSectionChange: (section: SettingsSection) => void;
  onLogout: () => void;
};

const chatNavItems = [{ label: 'Search', icon: Search }] as const;

const coworkNavItems = [
  { label: 'Search', icon: Search },
] as const;

const workspaceNavItems: { label: string; icon: typeof FolderOpen; page: AppPage }[] = [
  { label: 'Files', icon: FolderOpen, page: 'files' },
  { label: 'Activity', icon: Zap, page: 'activity' },
  { label: 'Memory', icon: Brain, page: 'memory' },
  { label: 'Schedule', icon: CalendarClock, page: 'scheduled' },
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
  gatewayConnected,
  language,
  settingsSection,
  recentItems,
  scheduledItems,
  scheduledLoading,
  onSelectRecentItem,
  onStartNewChat,
  onStartNewTask,
  onSelectMenuItem,
  onSelectPage,
  onOpenSearch,
  onOpenSettings,
  onSettingsSectionChange,
  onLogout,
}: AppSidebarProps) {
  const t = (en: string, de: string) => (language === 'de' ? de : en);
  const isChatView = activePage === 'chat';
  const isSettingsView = activePage === 'settings';
  const isWorkspacePage = ['files', 'activity', 'memory', 'scheduled', 'safety'].includes(activePage);
  const compact = !sidebarOpen;
  const navItems = isChatView ? chatNavItems : coworkNavItems;
  const safeRecentItems = recentItems ?? [];
  const safeScheduledItems = scheduledItems ?? [];
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profilePopupPositionClass = compact
    ? 'left-full bottom-0 ml-2'
    : 'bottom-full right-0 mb-2';
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

  return (
    <Sidebar
      className="w-full rounded-none border-y-0 border-l-0 transition-all duration-200"
    >
      <SidebarContent>
        {isSettingsView ? (
          /* ── Settings navigation ── */
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu aria-label="Settings back navigation">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      type="button"
                      className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                      title={t('Back', 'Zurueck')}
                      aria-label="Back to workspace"
                      onClick={onStartNewChat}
                    >
                      <ArrowLeft data-icon="inline-start" />
                      {!compact && <span>{t('Back', 'Zurueck')}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup className="mt-3">
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
                        {!compact && <span>{sectionLabels[item.label][language]}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          /* ── Regular chat/cowork navigation ── */
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu aria-label="Primary workspace menu">
                  {isWorkspacePage && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                        title="Back to Cowork"
                        aria-label="Back to cowork"
                        onClick={() => onSelectPage('cowork')}
                      >
                        <ArrowLeft data-icon="inline-start" />
                        {!compact && <span>Back to Cowork</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      type="button"
                      className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                      title={isChatView ? 'New Chat' : 'New Task'}
                      aria-label={isChatView ? 'Start a new chat' : 'Start a new task'}
                      onClick={isChatView ? onStartNewChat : onStartNewTask}
                    >
                      <Plus data-icon="inline-start" />
                      {!compact && <span>{isChatView ? 'New Chat' : 'New Task'}</span>}
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
                        {!compact && <span>{item.label}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Workspace pages */}
            {!isChatView && (
              <SidebarGroup className="mt-3">
                {!compact && <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {workspaceNavItems.map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          type="button"
                          active={activePage === item.page}
                          aria-current={activePage === item.page ? 'page' : undefined}
                          onClick={() => onSelectPage(item.page)}
                          className={`gap-2 font-sans text-[13px] ${compact ? 'justify-center px-0' : ''}`}
                          title={item.label}
                        >
                          <item.icon data-icon="inline-start" />
                          {!compact && <span>{item.label}</span>}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {!compact && (
              <SidebarGroup className="mt-3 grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <SidebarGroupLabel>Recents</SidebarGroupLabel>
                <SidebarGroupContent className="min-h-0">
                  <ScrollArea className="h-full min-h-0">
                    <SidebarMenu className="pr-0.5">
                      {safeRecentItems.length === 0 ? (
                        <SidebarMenuItem>
                          <SidebarMenuButton type="button" className="w-full justify-start font-sans text-[12px] text-muted-foreground" disabled>
                            {isChatView ? 'No recent chats yet' : 'No recent runs yet'}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ) : (
                        safeRecentItems.map((item) => (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              type="button"
                              active={
                                (item.kind === 'chat' && item.sessionKey === activeSessionKey) ||
                                (item.kind === 'cowork' && item.sessionKey === activeCoworkSessionKey)
                              }
                              aria-current={
                                (item.kind === 'chat' && item.sessionKey === activeSessionKey) ||
                                (item.kind === 'cowork' && item.sessionKey === activeCoworkSessionKey)
                                  ? 'page'
                                  : undefined
                              }
                              aria-label={`Open ${item.kind === 'cowork' ? 'task' : 'chat'} ${item.label}`}
                              className="w-full gap-2 font-sans text-[12px]"
                              title={item.label}
                              onClick={() => onSelectRecentItem(item)}
                            >
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {item.kind === 'cowork' ? 'Task' : 'Chat'}
                              </span>
                              <span className="block truncate">{item.label}</span>
                            </SidebarMenuButton>
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
      </SidebarContent>

      <SidebarFooter>
        <div className={`flex items-center gap-2 px-3 py-1 ${compact ? 'justify-center' : ''}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${gatewayConnected ? 'bg-[#2f7a58]' : 'bg-[#b42318]'}`} />
          {!compact && (
            <span className="font-sans text-[11px] text-muted-foreground">
              {gatewayConnected ? t('Gateway connected', 'Gateway verbunden') : t('Gateway disconnected', 'Gateway getrennt')}
            </span>
          )}
        </div>
        <div className="relative" ref={profileMenuRef}>
          {profileMenuOpen && (
            <div className={`absolute z-50 w-64 rounded-xl border border-border bg-background p-1 shadow-xl ${profilePopupPositionClass}`}>
              <div className="flex items-center gap-3 px-2.5 py-2">
                <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
                  <p className="text-xs text-muted-foreground">{guestMode ? 'Local mode' : 'Cloud mode'}</p>
                </div>
              </div>
              <Separator />
              <div className="grid gap-1 p-1">
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground" onClick={onOpenSettings}>
                  <Settings data-icon="inline-start" />
                  {t('Settings', 'Einstellungen')}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    onOpenSettings();
                    onSettingsSectionChange('Appearance');
                    setProfileMenuOpen(false);
                  }}
                >
                  <Globe data-icon="inline-start" />
                  {t('Language', 'Sprache')}
                </button>
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground">
                  <HelpCircle data-icon="inline-start" />
                  {t('Get help', 'Hilfe erhalten')}
                </button>
                <Separator className="my-1" />
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground" onClick={onLogout}>
                  <LogOut data-icon="inline-start" />
                  {guestMode ? t('Exit local mode', 'Lokalen Modus beenden') : t('Sign out', 'Abmelden')}
                </button>
              </div>
            </div>
          )}
          <div className={`rounded-xl border border-border bg-background py-2 ${compact ? 'flex justify-center px-1' : 'flex items-center justify-between gap-3 px-2'}`}>
            <div className={`flex items-center gap-3 ${compact ? '' : 'min-w-0'}`}>
              {compact ? (
                <button
                  type="button"
                  aria-label="Open account menu"
                  aria-expanded={profileMenuOpen}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {userInitials}
                </button>
              ) : (
                <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                  {userInitials}
                </div>
              )}
              {!compact && (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
                  <p className="text-xs text-muted-foreground">{guestMode ? 'Local mode' : 'Cloud mode'}</p>
                </div>
              )}
            </div>
            {!compact && (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Download">
                  <Download data-icon="inline-start" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open account menu"
                  aria-expanded={profileMenuOpen}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  className={profileMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
                >
                  <ChevronUp data-icon="inline-start" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
