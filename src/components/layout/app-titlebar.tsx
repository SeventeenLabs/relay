import type { CSSProperties, MouseEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AppPage = 'chat' | 'cowork' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  isMaximized: boolean;
  usageModeLabel: string;
  minimal?: boolean;
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
  usageModeLabel,
  minimal,
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
    <header className="relative flex h-[44px] items-center justify-between border-b border-border bg-background/90 pl-1">
      {!minimal && (
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
          {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label="Back">
          ←
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" className="size-6 text-muted-foreground" aria-label="Forward">
          →
        </Button>
      </div>
      )}

      <div
        className="flex h-full flex-1 items-center justify-center px-2 pr-[126px]"
        style={dragRegionStyle}
        onDoubleClick={handleTitlebarDoubleClick}
        onContextMenu={handleTitlebarContextMenu}
      >
        {!minimal && (
        <div className="inline-flex items-center" style={noDragStyle} aria-label="workspace mode">
          <Tabs
            value={activePage === 'chat' || activePage === 'cowork' ? activePage : 'chat'}
            onValueChange={(nextMode) => {
              if (nextMode === 'chat' || nextMode === 'cowork') {
                onSelectPage(nextMode);
              }
            }}
            className="gap-0"
          >
            <TabsList className="h-9 rounded-xl border-0 bg-transparent px-1 py-1 shadow-none gap-1">
              {modeOptions.map((mode) => (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  className="h-7 min-w-[84px] rounded-lg px-3 font-sans text-[12px] font-semibold tracking-[0.03em] uppercase text-muted-foreground data-active:border-transparent data-active:bg-[linear-gradient(120deg,#e5a48a,#d98765)] data-active:text-[#fffefb]"
                  style={noDragStyle}
                >
                  {mode}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        )}
      </div>

      <div
        className="absolute inset-y-0 right-0 z-20 inline-flex items-center [-webkit-app-region:no-drag]"
        style={noDragStyle}
        onMouseDown={preventTitlebarDragCapture}
        onDoubleClick={preventTitlebarDragCapture}
      >
        <button
          type="button"
          className="h-[44px] w-[42px] border-0 bg-transparent text-[16px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onMinimize()}
          aria-label="Minimize"
        >
          −
        </button>
        <button
          type="button"
          className="h-[44px] w-[42px] border-0 bg-transparent text-[13px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onToggleMaximize()}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? '❐' : '□'}
        </button>
        <button
          type="button"
          className="h-[44px] w-[42px] border-0 bg-transparent text-[16px] leading-none text-muted-foreground transition-colors hover:bg-[#dd5f4c] hover:text-white"
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
