import * as React from 'react';

import { cn } from '@/lib/utils';

function SidebarProvider({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-provider" className={cn('size-full', className)} {...props} />;
}

function Sidebar({ className, ...props }: React.ComponentProps<'aside'>) {
  return (
    <aside
      data-slot="sidebar"
      className={cn('flex h-full w-full flex-col rounded-xl border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('border-b border-border p-3', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('min-h-0 flex-1 p-2', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('border-t border-border p-2', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('grid gap-1', className)} {...props} />;
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
  return <ul data-slot="sidebar-menu" className={cn('grid gap-1', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} />;
}

function SidebarMenuButton({
  className,
  active = false,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground',
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
