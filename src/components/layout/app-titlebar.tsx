import type { CSSProperties, MouseEvent } from 'react';
import { AlertCircle, ArrowLeft, Copy, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react';

import type { CoworkProgressStep, CoworkRunPhase } from '@/app-types';
import { Button } from '@/components/ui/button';

type AppPage = 'chat' | 'cowork' | 'project' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'approvals' | 'safety' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  coworkRightPanelOpen?: boolean;
  isMaximized: boolean;
  usageModeLabel: string;
  gatewayConnected?: boolean;
  showGatewayError?: boolean;
  coworkRunPhase?: CoworkRunPhase;
  coworkRunStatus?: string;
  coworkProgressSteps?: CoworkProgressStep[];
  coworkFilesTouchedCount?: number;
  coworkSessionKey?: string;
  onSaveRunAsSkill?: () => void;
  onScheduleRun?: () => void;
  minimal?: boolean;
  onToggleSidebar: () => void;
  onToggleCoworkRightPanel?: () => void;
  onSelectPage: (page: 'cowork') => void;
  onMinimize: () => void | Promise<void>;
  onToggleMaximize: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  onShowSystemMenu: (x: number, y: number) => void | Promise<void>;
  onOpenGatewaySettings?: () => void;
};

export function AppTitlebar({
  sidebarOpen,
  activePage,
  coworkRightPanelOpen = true,
  isMaximized,
  gatewayConnected = false,
  showGatewayError = false,
  minimal,
  onToggleSidebar,
  onToggleCoworkRightPanel,
  onSelectPage,
  onMinimize,
  onToggleMaximize,
  onClose,
  onShowSystemMenu,
  onOpenGatewaySettings,
}: AppTitlebarProps) {
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
          {showGatewayError ? (
            <button
              type="button"
              className="inline-flex h-6 w-6 min-h-6 min-w-6 shrink-0 items-center justify-center border border-blue-500/45 bg-blue-500 p-0 text-white transition hover:bg-blue-500/90"
              style={{ ...noDragStyle, borderRadius: '9999px' }}
              onClick={() => onOpenGatewaySettings?.()}
              title="Connection error. Open gateway settings."
              aria-label="Connection error. Open gateway settings."
            >
              <AlertCircle className="size-3.5" />
            </button>
          ) : null}
          {showBackButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-muted-foreground text-xs"
              style={noDragStyle}
              onClick={() => onSelectPage('cowork')}
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
        {!minimal && activePage === 'cowork' && onToggleCoworkRightPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="mr-1 size-6 border-0 text-muted-foreground shadow-none"
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
          className={`window-control-btn ${windowControlBaseClass} hover:bg-[#d45d4e] hover:text-white active:bg-[#bf4e41] focus-visible:ring-[#d45d4e]/40`}
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
