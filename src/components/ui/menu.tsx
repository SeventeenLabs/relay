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
        'inline-flex h-8 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Menu, MenuGroup, MenuItem, MenuLabel };
