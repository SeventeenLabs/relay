import type { CSSProperties, MouseEvent } from 'react';
import { ArrowLeft, Copy, Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';

import type { CoworkProgressStep, CoworkRunPhase } from '@/app-types';
import { Button } from '@/components/ui/button';

type AppPage = 'chat' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  isMaximized: boolean;
  usageModeLabel: string;
  hermesConnected?: boolean;
  showConnectionError?: boolean;
  coworkRunPhase?: CoworkRunPhase;
  coworkRunStatus?: string;
  coworkProgressSteps?: CoworkProgressStep[];
  coworkFilesTouchedCount?: number;
  coworkSessionKey?: string;
  onSaveRunAsSkill?: () => void;
  onScheduleRun?: () => void;
  minimal?: boolean;
  onToggleSidebar: () => void;
  onSelectPage: (page: 'chat') => void;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  onShowSystemMenu: (x: number, y: number) => void | Promise<void>;
  onOpenConnectionSettings?: () => void;
};

export function AppTitlebar({
  sidebarOpen,
  activePage,
  isMaximized,
  hermesConnected = false,
  showConnectionError = false,
  minimal,
  onToggleSidebar,
  onSelectPage,
  onMinimize,
  onToggleMaximize,
  onClose,
  onShowSystemMenu,
  onOpenConnectionSettings,
}: AppTitlebarProps) {
  void hermesConnected;
  void showConnectionError;
  void onOpenConnectionSettings;
  const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const showBackButton = activePage === 'settings';

  const windowControlBaseClass =
    'inline-flex h-[36px] w-[40px] items-center justify-center rounded-none border-0 bg-transparent text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const neutralWindowControlClass = 'window-control-neutral';

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
    <header className="app-titlebar relative flex h-[36px] items-center justify-between overflow-hidden bg-background pl-1">
      {!minimal ? (
        <div
          className="inline-flex min-w-[124px] items-center gap-1 [-webkit-app-region:no-drag]"
          style={noDragStyle}
          aria-label="navigation controls"
          onMouseDown={preventTitlebarDragCapture}
          onDoubleClick={preventTitlebarDragCapture}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 border-0 text-muted-foreground shadow-none"
            style={noDragStyle}
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          {showBackButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-muted-foreground text-xs"
              style={noDragStyle}
              onClick={() => onSelectPage('chat')}
              aria-label="Back"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back</span>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        className="flex h-full flex-1 items-center justify-center px-2 pr-[114px]"
        style={dragRegionStyle}
        onDoubleClick={handleTitlebarDoubleClick}
        onContextMenu={handleTitlebarContextMenu}
      />

      <div
        className="absolute inset-y-0 right-0 z-20 inline-flex items-center [-webkit-app-region:no-drag]"
        style={noDragStyle}
        onMouseDown={preventTitlebarDragCapture}
        onDoubleClick={preventTitlebarDragCapture}
      >
        <button
          type="button"
          className={`window-control-btn ${windowControlBaseClass} ${neutralWindowControlClass}`}
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
          className={`window-control-btn ${windowControlBaseClass} ${neutralWindowControlClass}`}
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
          className={`window-control-btn window-control-close ${windowControlBaseClass}`}
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

