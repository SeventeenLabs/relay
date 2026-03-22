import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarClock,
  ChevronUp,
  Download,
  Globe,
  HelpCircle,
  Lightbulb,
  LogOut,
  Plus,
  Search,
  Settings,
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

type AppPage = 'chat' | 'cowork' | 'settings';

type RecentSidebarItem = {
  id: string;
  label: string;
  sessionKey: string;
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
  userEmail: string;
  guestMode: boolean;
  recentItems: RecentSidebarItem[];
  scheduledItems: ScheduledSidebarItem[];
  scheduledLoading: boolean;
  onSelectRecentChat: (sessionKey: string) => void;
  onStartNewChat: () => void;
  onStartNewTask: () => void;
  onSelectMenuItem: (item: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

const chatNavItems = [{ label: 'Search', icon: Search }] as const;

const coworkNavItems = [
  { label: 'Search', icon: Search },
  { label: 'Scheduled', icon: CalendarClock },
  { label: 'Ideas', icon: Lightbulb },
  { label: 'Customize', icon: BriefcaseBusiness },
] as const;

export function AppSidebar({
  sidebarOpen,
  activeMenuItem,
  activePage,
  activeSessionKey,
  userEmail,
  guestMode,
  recentItems,
  scheduledItems,
  scheduledLoading,
  onSelectRecentChat,
  onStartNewChat,
  onStartNewTask,
  onSelectMenuItem,
  onOpenSearch,
  onOpenSettings,
  onLogout,
}: AppSidebarProps) {
  const isChatView = activePage === 'chat';
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Primary workspace menu">
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

        {!compact && (
          <SidebarGroup className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] mt-1">
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
                          active={isChatView && item.sessionKey === activeSessionKey}
                          aria-current={isChatView && item.sessionKey === activeSessionKey ? 'page' : undefined}
                          aria-label={`Open chat ${item.label}`}
                          className="w-full gap-2 font-sans text-[12px]"
                          title={item.label}
                          onClick={() => {
                            onSelectRecentChat(item.sessionKey);
                          }}
                        >
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

        {!isChatView && !compact && (
          <SidebarGroup className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] mt-1">
            <SidebarGroupLabel>Scheduled</SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0">
              <ScrollArea className="h-full min-h-0">
                <SidebarMenu className="pr-0.5">
                  {scheduledLoading ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton type="button" className="w-full justify-start font-sans text-[12px] text-muted-foreground" disabled>
                        Loading scheduled jobs...
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : safeScheduledItems.length === 0 ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton type="button" className="w-full justify-start font-sans text-[12px] text-muted-foreground" disabled>
                        No scheduled jobs
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : (
                    safeScheduledItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          type="button"
                          className="w-full items-start gap-2 font-sans text-[12px]"
                          onClick={() => onSelectMenuItem('Scheduled')}
                        >
                          <span className="block truncate font-medium text-foreground">{item.name}</span>
                          <span className="text-[11px] text-muted-foreground">{item.schedule}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </ScrollArea>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="relative" ref={profileMenuRef}>
          {profileMenuOpen && (
            <div className={`absolute z-50 w-64 rounded-xl border border-border bg-white p-1 shadow-xl ${profilePopupPositionClass}`}>
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
                  Einstellungen
                </button>
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground">
                  <Globe data-icon="inline-start" />
                  Sprache
                </button>
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground">
                  <HelpCircle data-icon="inline-start" />
                  Hilfe erhalten
                </button>
                <Separator className="my-1" />
                <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground" onClick={onLogout}>
                  <LogOut data-icon="inline-start" />
                  {guestMode ? 'Exit local mode' : 'Abmelden'}
                </button>
              </div>
            </div>
          )}
          <div className={`rounded-xl border border-border bg-white py-2 ${compact ? 'flex justify-center px-1' : 'flex items-center justify-between gap-3 px-2'}`}>
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
