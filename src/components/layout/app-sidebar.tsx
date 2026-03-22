import { BriefcaseBusiness, CalendarClock, Lightbulb, LogOut, Plus, Search, Settings, UserRound } from 'lucide-react';

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

type AppPage = 'chat' | 'cowork' | 'scheduled' | 'settings';

type RecentSidebarItem = {
  id: string;
  label: string;
  sessionKey: string;
};

type AppSidebarProps = {
  sidebarOpen: boolean;
  activeMenuItem: string;
  activePage: AppPage;
  activeSessionKey: string;
  userEmail: string;
  guestMode: boolean;
  recentItems: RecentSidebarItem[];
  onSelectRecentChat: (sessionKey: string) => void;
  onStartNewChat: () => void;
  onSelectMenuItem: (item: string) => void;
  onSelectPage: (page: AppPage) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

const navItems = [
  { label: 'Search', icon: Search },
  { label: 'Scheduled', icon: CalendarClock, page: 'scheduled' as const },
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
  onSelectRecentChat,
  onStartNewChat,
  onSelectMenuItem,
  onSelectPage,
  onOpenSettings,
  onLogout,
}: AppSidebarProps) {
  return (
    <Sidebar
      className={`rounded-none border-y-0 border-l-0 transition-all duration-200 ${
        sidebarOpen ? 'w-full opacity-100' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="primary workspace menu">
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  className="gap-2 font-sans text-[13px]"
                  title="New Chat"
                  onClick={onStartNewChat}
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  <span>New Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    type="button"
                    active={item.label === activeMenuItem}
                    onClick={() => {
                      onSelectMenuItem(item.label);
                      if (item.page) {
                        onSelectPage(item.page);
                      }
                    }}
                    className="gap-2 font-sans text-[13px]"
                    title={item.label}
                  >
                    <item.icon className="size-3.5 text-muted-foreground" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="my-1" />

        <SidebarGroup className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <SidebarGroupLabel>Recents</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0">
            <ScrollArea className="h-full min-h-0">
              <SidebarMenu className="gap-1 pr-1">
                {recentItems.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton type="button" className="w-full justify-start font-sans text-[12px] text-muted-foreground" disabled>
                      No recent chats yet
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  recentItems.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        type="button"
                        active={activePage === 'chat' && item.sessionKey === activeSessionKey}
                        className="w-full truncate font-sans text-[12px]"
                        title={item.label}
                        onClick={() => {
                          onSelectRecentChat(item.sessionKey);
                        }}
                      >
                        {item.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="grid gap-1">
          <Button
            type="button"
            variant="ghost"
            className={`h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-sans text-xs ${
              activePage === 'settings' ? 'bg-muted text-foreground' : ''
            }`}
            onClick={onOpenSettings}
          >
            <Settings className="size-3.5 text-muted-foreground" />
            Settings
          </Button>
          <Button type="button" variant="ghost" className="h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-sans text-xs" title={userEmail}>
            <UserRound className="size-3.5 text-muted-foreground" />
            {userEmail}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-sans text-xs"
            onClick={onLogout}
          >
            <LogOut className="size-3.5 text-muted-foreground" />
            {guestMode ? 'Exit local mode' : 'Logout'}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
