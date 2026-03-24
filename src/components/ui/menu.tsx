import * as React from 'react';

import { cn } from '@/lib/utils';

function Menu({ className, ...props }: React.ComponentProps<'nav'>) {
  return <nav data-slot="menu" className={cn('grid gap-1', className)} {...props} />;
}

function MenuGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="menu-group" className={cn('grid gap-1', className)} {...props} />;
}

function MenuLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="menu-label"
      className={cn('px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase', className)}
      {...props}
    />
  );
}

function MenuItem({ className, active = false, ...props }: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      data-slot="menu-item"
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-9 w-full items-center rounded-xl px-3 text-left text-sm text-foreground/80 transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=true]:shadow-[0_1px_0_rgba(0,0,0,0.05)]',
        className,
      )}
      {...props}
    />
  );
}

export { Menu, MenuGroup, MenuItem, MenuLabel };
