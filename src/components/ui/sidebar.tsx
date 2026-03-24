import * as React from 'react';

import { cn } from '@/lib/utils';

function SidebarProvider({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-provider" className={cn('size-full', className)} {...props} />;
}

function Sidebar({ className, ...props }: React.ComponentProps<'aside'>) {
  return (
    <aside
      data-slot="sidebar"
      className={cn('flex h-full w-full min-w-0 flex-col rounded-none border-r border-border bg-background text-foreground', className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('p-3', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('min-h-0 flex-1 p-1.5', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('p-1.5', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('grid gap-0.5', className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="sidebar-group-label"
      className={cn('px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase', className)}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('min-h-0', className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('grid gap-0.5', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} />;
}

function SidebarMenuButton({
  className,
  active = false,
  isActive,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean; isActive?: boolean }) {
  const resolvedActive = isActive ?? active;

  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={resolvedActive ? 'true' : undefined}
      className={cn(
        'group inline-flex h-8 w-full min-w-0 items-center overflow-hidden rounded-md px-2 text-left text-sm text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground hover:[&>svg]:text-foreground data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-foreground',
        resolvedActive && 'bg-muted',
        className,
      )}
      {...props}
    />
  );
}

export {
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
  SidebarProvider,
};
