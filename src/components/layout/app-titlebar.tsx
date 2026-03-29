import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { ArrowLeft, Circle, Copy, Loader2, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Square, TriangleAlert, X } from 'lucide-react';

import type { CoworkProgressStep, CoworkRunPhase } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type AppPage = 'cowork' | 'project' | 'files' | 'local-files' | 'activity' | 'memory' | 'scheduled' | 'approvals' | 'safety' | 'settings';

type AppTitlebarProps = {
  sidebarOpen: boolean;
  activePage: AppPage;
  coworkRightPanelOpen?: boolean;
  isMaximized: boolean;
  usageModeLabel: string;
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
};

export function AppTitlebar({
  sidebarOpen,
  activePage,
  coworkRightPanelOpen = true,
  isMaximized,
  usageModeLabel,
  coworkRunPhase = 'idle',
  coworkRunStatus = 'Ready for a new task.',
  coworkProgressSteps = [],
  coworkFilesTouchedCount = 0,
  coworkSessionKey = '',
  onSaveRunAsSkill,
  onScheduleRun,
  minimal,
  onToggleSidebar,
  onToggleCoworkRightPanel,
  onSelectPage,
  onMinimize,
  onToggleMaximize,
  onClose,
  onShowSystemMenu,
}: AppTitlebarProps) {
  const [progressPopupOpen, setProgressPopupOpen] = useState(false);
  const progressPopupRef = useRef<HTMLDivElement | null>(null);
  const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const showModeTabs = false;
  const isWorkspacePage = ['project', 'files', 'local-files', 'activity', 'memory', 'scheduled', 'approvals', 'safety'].includes(activePage);
  const isSettingsPage = activePage === 'settings';
  const showBackButton = isWorkspacePage || isSettingsPage;
  const windowControlBaseClass =
    'inline-flex h-[44px] w-[46px] items-center justify-center rounded-none border-0 bg-transparent text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const neutralWindowControlClass = 'window-control-neutral';
  const coworkProgressSummary = useMemo(() => {
    const total = coworkProgressSteps.length;
    const completed = coworkProgressSteps.filter((step) => step.status === 'completed').length;
    const blocked = coworkProgressSteps.filter((step) => step.status === 'blocked').length;
    const active = coworkProgressSteps.find((step) => step.status === 'active') ?? null;
    const percent = total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100));
    return { total, completed, blocked, active, percent };
  }, [coworkProgressSteps]);

  const runPhaseToneClass =
    coworkRunPhase === 'completed'
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : coworkRunPhase === 'streaming' || coworkRunPhase === 'sending'
        ? 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300'
        : coworkRunPhase === 'error'
          ? 'border-destructive/35 bg-destructive/10 text-destructive'
          : 'border-border bg-muted text-muted-foreground';

  const runPhaseLabel =
    coworkRunPhase === 'sending'
      ? 'Sending'
      : coworkRunPhase === 'streaming'
        ? 'Streaming'
        : coworkRunPhase === 'completed'
          ? 'Completed'
          : coworkRunPhase === 'error'
            ? 'Error'
            : 'Idle';

  useEffect(() => {
    if (!progressPopupOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (progressPopupRef.current?.contains(target)) {
        return;
      }
      setProgressPopupOpen(false);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProgressPopupOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, [progressPopupOpen]);

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
    <header className="app-titlebar relative flex h-[44px] items-center justify-between bg-background pl-1">
      {!minimal && (
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
          className="size-6 text-muted-foreground"
          style={noDragStyle}
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        </Button>
        {showBackButton && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-muted-foreground text-xs"
            style={noDragStyle}
            onClick={() => onSelectPage('cowork')}
            aria-label={isSettingsPage ? 'Back' : 'Back to cowork'}
          >
            <ArrowLeft className="size-3.5" />
            <span>{isSettingsPage ? 'Back' : 'Back to Cowork'}</span>
          </Button>
        )}
      </div>
      )}

      <div
        className="flex h-full flex-1 items-center justify-center px-2 pr-[126px]"
        style={dragRegionStyle}
        onDoubleClick={handleTitlebarDoubleClick}
        onContextMenu={handleTitlebarContextMenu}
      >
        {showModeTabs ? <div /> : null}
      </div>

      <div
        className="absolute inset-y-0 right-0 z-20 inline-flex items-center [-webkit-app-region:no-drag]"
        style={noDragStyle}
        onMouseDown={preventTitlebarDragCapture}
        onDoubleClick={preventTitlebarDragCapture}
      >
        {!minimal && activePage === 'cowork' ? (
          <div className="relative" ref={progressPopupRef}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mr-2 h-7 gap-1.5 rounded-lg px-2 text-[11px]"
              style={noDragStyle}
              onClick={() => setProgressPopupOpen((current) => !current)}
              title="Open progress details"
              aria-label="Open progress details"
              aria-expanded={progressPopupOpen}
              data-testid="titlebar-progress-trigger"
            >
              {coworkRunPhase === 'sending' || coworkRunPhase === 'streaming' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              <span>{coworkProgressSummary.completed}/{coworkProgressSummary.total || 0}</span>
              <Badge variant="outline" className={`h-5 rounded-full px-1.5 text-[10px] ${runPhaseToneClass}`}>
                {runPhaseLabel}
              </Badge>
            </Button>

            {progressPopupOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(560px,92vw)] rounded-xl border border-border bg-background p-3 shadow-xl"
                style={noDragStyle}
                role="dialog"
                aria-label="Cowork progress details"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Cowork Progress</p>
                    <p className="text-xs text-muted-foreground">{coworkRunStatus}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => setProgressPopupOpen(false)} aria-label="Close progress popup">
                    <X className="size-3.5" />
                  </Button>
                </div>

                <div className="grid gap-3 max-h-[70vh] overflow-y-auto pr-1">
                  <div className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-sans text-xs text-muted-foreground">{coworkProgressSummary.completed}/{coworkProgressSummary.total} completed</p>
                      <p className="font-sans text-xs font-semibold text-foreground">{coworkProgressSummary.percent}%</p>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${coworkProgressSummary.percent}%` }} />
                    </div>
                    {coworkProgressSummary.active ? (
                      <p className="mt-2 font-sans text-xs text-muted-foreground">
                        Active: <span className="text-foreground">{coworkProgressSummary.active.label}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    {coworkProgressSteps.map((step) => {
                      const stepToneClass =
                        step.status === 'completed'
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : step.status === 'active'
                            ? 'border-blue-500/40 bg-blue-500/12 text-blue-700 dark:text-blue-300'
                            : step.status === 'blocked'
                              ? 'border-destructive/35 bg-destructive/10 text-destructive'
                              : 'border-border bg-muted text-muted-foreground';

                      return (
                        <div key={step.stage} className="rounded-lg border border-border bg-background p-2.5">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${stepToneClass}`}>
                                {step.status === 'active' ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : step.status === 'blocked' ? (
                                  <TriangleAlert className="size-3" />
                                ) : (
                                  <Circle className="size-3" />
                                )}
                              </span>
                              <p className="truncate font-sans text-xs text-foreground">{step.label}</p>
                            </div>
                            <Badge variant="outline" className={`rounded-full text-[10px] capitalize ${stepToneClass}`}>
                              {step.status}
                            </Badge>
                          </div>
                          {step.details ? <p className="font-sans text-[11px] text-muted-foreground">{step.details}</p> : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-xs text-muted-foreground">
                    <p>Files touched: <span className="text-foreground">{coworkFilesTouchedCount}</span></p>
                    {coworkProgressSummary.blocked > 0 ? (
                      <p className="mt-1 text-destructive">{coworkProgressSummary.blocked} blocked step(s)</p>
                    ) : null}
                    {coworkSessionKey ? <p className="mt-1">Session: {coworkSessionKey}</p> : null}
                    <p className="mt-1">Mode: {usageModeLabel}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {onSaveRunAsSkill ? (
                      <Button type="button" size="sm" variant="outline" onClick={onSaveRunAsSkill}>
                        Save as skill
                      </Button>
                    ) : null}
                    {onScheduleRun ? (
                      <Button type="button" size="sm" variant="outline" onClick={onScheduleRun}>
                        Schedule run
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
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
