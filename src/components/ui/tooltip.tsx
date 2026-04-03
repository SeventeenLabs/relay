import * as React from 'react';

import { cn } from '@/lib/utils';

type TooltipContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

function useTooltipContext() {
  const context = React.useContext(TooltipContext);
  if (!context) {
    throw new Error('Tooltip components must be used within <Tooltip>.');
  }
  return context;
}

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <span className="relative inline-flex">{children}</span>
    </TooltipContext.Provider>
  );
}

type TooltipTriggerProps = {
  asChild?: boolean;
  children: React.ReactNode;
};

function TooltipTrigger({ asChild = false, children }: TooltipTriggerProps) {
  const { setOpen } = useTooltipContext();

  const triggerProps = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  };

  if (asChild && React.isValidElement(children)) {
    const childProps = children.props as Record<string, unknown>;
    return React.cloneElement(children, {
      ...triggerProps,
      ...childProps,
      onMouseEnter: (event: unknown) => {
        triggerProps.onMouseEnter();
        if (typeof childProps.onMouseEnter === 'function') {
          (childProps.onMouseEnter as (arg: unknown) => void)(event);
        }
      },
      onMouseLeave: (event: unknown) => {
        triggerProps.onMouseLeave();
        if (typeof childProps.onMouseLeave === 'function') {
          (childProps.onMouseLeave as (arg: unknown) => void)(event);
        }
      },
      onFocus: (event: unknown) => {
        triggerProps.onFocus();
        if (typeof childProps.onFocus === 'function') {
          (childProps.onFocus as (arg: unknown) => void)(event);
        }
      },
      onBlur: (event: unknown) => {
        triggerProps.onBlur();
        if (typeof childProps.onBlur === 'function') {
          (childProps.onBlur as (arg: unknown) => void)(event);
        }
      },
    } as Record<string, unknown>);
  }

  return (
    <span tabIndex={0} {...triggerProps}>
      {children}
    </span>
  );
}

type TooltipContentProps = React.ComponentProps<'div'>;

function TooltipContent({ className, children, ...props }: TooltipContentProps) {
  const { open } = useTooltipContext();
  return (
    <div
      role="tooltip"
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'pointer-events-none absolute bottom-[calc(100%+0.35rem)] left-1/2 z-50 w-max max-w-[220px] -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-center text-[11px] text-popover-foreground shadow-md transition-opacity',
        open ? 'opacity-100' : 'opacity-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
