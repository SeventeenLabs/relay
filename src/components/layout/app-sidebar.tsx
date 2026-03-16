import { BriefcaseBusiness, CalendarClock, Lightbulb, Plus, Search, Settings, UserRound } from 'lucide-react';

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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

type AppPage = 'chat' | 'cowork' | 'settings';

type AppSidebarProps = {
  sidebarOpen: boolean;
  activeMenuItem: string;
  activePage: AppPage;
  onSelectMenuItem: (item: string) => void;
  onOpenSettings: () => void;
};

const navItems = [
  { label: 'New task', icon: Plus },
  { label: 'Search', icon: Search },
  { label: 'Scheduled', icon: CalendarClock },
  { label: 'Ideas', icon: Lightbulb },
  { label: 'Customize', icon: BriefcaseBusiness },
] as const;

const recentTasks = [
  'Run SEO audit for benai.co',
  'Analyze YouTube Studio data structure',
  'Curate newsletter ideas from AI source docs',
  'Create Google Doc with campaign brief',
  'Convert LinkedIn post to infographic outline',
  'Build newsletter writer skill from examples',
  'Review sales pipeline and next actions',
];

export function AppSidebar({ sidebarOpen, activeMenuItem, activePage, onSelectMenuItem, onOpenSettings }: AppSidebarProps) {
  return (
    <Sidebar
      className={`rounded-none border-y-0 border-l-0 transition-all duration-200 ${
        sidebarOpen ? 'w-full opacity-100' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      <SidebarHeader>
        <h2 className="text-sm font-semibold">OpenClawCowork</h2>
        <p className="font-sans text-xs text-muted-foreground">Agentic desktop workbench</p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="primary workspace menu">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    type="button"
                    active={item.label === activeMenuItem}
                    onClick={() => onSelectMenuItem(item.label)}
                    className="gap-2 font-sans text-[13px]"
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
                {recentTasks.map((task) => (
                  <SidebarMenuItem key={task}>
                    <SidebarMenuButton type="button" className="w-full truncate font-sans text-[12px]" title={task}>
                      {task}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
          <Button type="button" variant="ghost" className="h-8 w-full justify-start gap-2 rounded-lg px-2.5 font-sans text-xs">
            <UserRound className="size-3.5 text-muted-foreground" />
            Ben AI
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
