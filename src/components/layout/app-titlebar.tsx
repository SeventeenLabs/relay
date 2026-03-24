import type { CSSProperties, MouseEvent } from 'react';
import { Copy, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AppPage = 'chat' | 'cowork' | 'files' | 'activity' | 'memory' | 'scheduled' | 'safety' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  coworkRightPanelOpen?: boolean;
  isMaximized: boolean;
  usageModeLabel: string;
  minimal?: boolean;
  onToggleSidebar: () => void;
  onToggleCoworkRightPanel?: () => void;
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
  coworkRightPanelOpen = true,
  isMaximized,
  usageModeLabel,
  minimal,
  onToggleSidebar,
  onToggleCoworkRightPanel,
  onSelectPage,
  onMinimize,
  onToggleMaximize,
  onClose,
  onShowSystemMenu,
}: AppTitlebarProps) {
  const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const showModeTabs = !minimal && activePage !== 'settings';
  const activeMode: 'chat' | 'cowork' = activePage === 'chat' ? 'chat' : 'cowork';
  const windowControlBaseClass =
    'inline-flex h-[44px] w-[46px] items-center justify-center border-0 bg-transparent text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const neutralWindowControlClass =
    'hover:bg-muted hover:text-foreground active:bg-muted/80';

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
        {showModeTabs && (
        <div className="inline-flex items-center" style={noDragStyle} aria-label="workspace mode">
          <Tabs
            value={activeMode}
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
        {!minimal && activePage === 'cowork' && onToggleCoworkRightPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mr-1 size-6 text-muted-foreground"
            style={noDragStyle}
            onClick={onToggleCoworkRightPanel}
            aria-label={coworkRightPanelOpen ? 'Hide cowork panel' : 'Show cowork panel'}
            title={coworkRightPanelOpen ? 'Hide cowork panel' : 'Show cowork panel'}
          >
            {coworkRightPanelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        ) : null}
        <button
          type="button"
          className={`${windowControlBaseClass} ${neutralWindowControlClass}`}
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onMinimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          className={`${windowControlBaseClass} ${neutralWindowControlClass}`}
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onToggleMaximize()}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
        </button>
        <button
          type="button"
          className={`${windowControlBaseClass} hover:bg-[#d45d4e] hover:text-white active:bg-[#bf4e41] focus-visible:ring-[#d45d4e]/40`}
          style={noDragStyle}
          onMouseDown={preventTitlebarDragCapture}
          onClick={() => void onClose()}
          aria-label="Close"
          title="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  );
}
