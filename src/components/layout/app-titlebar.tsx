import type { CSSProperties, MouseEvent } from 'react';

import { Button } from '@/components/ui/button';

type AppPage = 'chat' | 'cowork' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  isMaximized: boolean;
  onToggleSidebar: () => void;
  onSelectPage: (page: 'chat' | 'cowork') => void;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  onShowSystemMenu: (x: number, y: number) => void | Promise<void>;
};

const modeOptions = ['chat', 'cowork'] as const;

export function AppTitlebar({
  sidebarOpen,
  activePage,
  isMaximized,
  onToggleSidebar,
  onSelectPage,
  onMinimize,
  onToggleMaximize,
  onClose,
  onShowSystemMenu,
}: AppTitlebarProps) {
  const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

  const preventTitlebarDragCapture = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const handleTitlebarDoubleClick = async (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [data-no-titlebar-toggle="true"]')) {
      return;
    }

    await onToggleMaximize();
  };

  const handleTitlebarContextMenu = async (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) {
      return;
    }

    event.preventDefault();
    await onShowSystemMenu(event.screenX, event.screenY);
  };

  return (
    <header className="relative flex items-center justify-between border-b border-border bg-background/90 pl-1">
      <div
        className="inline-flex min-w-[124px] items-center gap-1 [-webkit-app-region:no-drag]"
        style={noDragStyle}
        aria-label="history controls"
        onMouseDown={preventTitlebarDragCapture}
        onDoubleClick={preventTitlebarDragCapture}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 text-muted-foreground"
          style={noDragStyle}
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          ☰
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label="Back">
          ←
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label="Forward">
          →
        </Button>
      </div>

      <div
        className="flex h-full flex-1 items-center justify-center px-2 pr-[126px]"
        style={dragRegionStyle}
        onDoubleClick={handleTitlebarDoubleClick}
        onContextMenu={handleTitlebarContextMenu}
      >
        <div className="inline-flex items-center gap-1" style={noDragStyle} aria-label="workspace mode">
          {modeOptions.map((mode) => (
            <Button
              key={mode}
              type="button"
              variant="ghost"
              size="xs"
              className={
                activePage === mode
                  ? 'h-6 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium capitalize text-foreground'
                  : 'h-6 rounded-md border border-transparent px-2.5 text-[11px] font-medium capitalize text-muted-foreground hover:text-foreground'
              }
              style={noDragStyle}
              onClick={() => onSelectPage(mode)}
              aria-pressed={activePage === mode}
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>

      <div
        className="absolute inset-y-0 right-0 z-20 inline-flex items-center [-webkit-app-region:no-drag]"
        style={noDragStyle}
        onMouseDown={preventTitlebarDragCapture}
        onDoubleClick={preventTitlebarDragCapture}
      >
        <button
          type="button"
          className="h-[34px] w-[42px] border-0 bg-transparent text-[16px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onMinimize()}
          aria-label="Minimize"
        >
          −
        </button>
        <button
          type="button"
          className="h-[34px] w-[42px] border-0 bg-transparent text-[13px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onToggleMaximize()}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? '❐' : '□'}
        </button>
        <button
          type="button"
          className="h-[34px] w-[42px] border-0 bg-transparent text-[16px] leading-none text-muted-foreground transition-colors hover:bg-[#dd5f4c] hover:text-white"
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onClose()}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </header>
  );
}
