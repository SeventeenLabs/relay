import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, ChevronDown, FileText, FolderOpen, Loader2, Plus, Shield } from 'lucide-react';

import type { ChatModelOption, ProjectPathReference } from '@/app-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Menu, MenuGroup, MenuItem } from '@/components/ui/menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const MODEL_VALUE_SEPARATOR = '::';

const composerDropdownItemClass =
  'h-8 rounded-lg px-2.5 text-[11px] leading-none text-foreground/85 hover:bg-muted/80 hover:text-foreground data-[active=true]:bg-primary/12 data-[active=true]:text-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/30';

type CoworkComposerProps = {
  taskPromptId: string;
  taskPrompt: string;
  textareaMinHeightClass: string;
  projectSelected: boolean;
  projectPathReferences: ProjectPathReference[];
  selectedModel: string;
  models: ChatModelOption[];
  modelsLoading: boolean;
  changingModel: boolean;
  sending: boolean;
  hermesConnected: boolean;
  approvalMode: 'standard' | 'project' | 'none';
  contextWindowUsedTokens: number;
  contextWindowTotalTokens: number;
  onTaskPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApprovalModeChange: (mode: 'standard' | 'project' | 'none') => void;
  onSubmit: (event: FormEvent) => void | Promise<void>;
};

export function CoworkComposer({
  taskPromptId,
  taskPrompt,
  textareaMinHeightClass,
  projectSelected,
  projectPathReferences,
  selectedModel,
  models,
  modelsLoading,
  changingModel,
  sending,
  hermesConnected,
  approvalMode,
  contextWindowUsedTokens,
  contextWindowTotalTokens,
  onTaskPromptChange,
  onModelChange,
  onApprovalModeChange,
  onSubmit,
}: CoworkComposerProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const composerEditorRef = useRef<HTMLTextAreaElement | null>(null);

  const [composerText, setComposerText] = useState(taskPrompt);
  const [openDropdown, setOpenDropdown] = useState<'model' | 'effort' | 'approvals' | null>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionMenuIndex, setMentionMenuIndex] = useState(0);
  const [effortLevel, setEffortLevel] = useState<'low' | 'medium' | 'high'>('medium');

  const canSend = composerText.trim().length > 0 && !sending && hermesConnected;
  const hasModelChoices = models.length > 0;
  const modelDropdownDisabled = modelsLoading || changingModel || !hasModelChoices;

  const parsedModels = useMemo(() => {
    return models.map((option) => {
      const rawValue = option.value.trim();
      const separatorIndex = rawValue.indexOf(MODEL_VALUE_SEPARATOR);
      let provider = 'unknown';
      let modelId = rawValue;

      if (separatorIndex > 0 && separatorIndex < rawValue.length - MODEL_VALUE_SEPARATOR.length) {
        provider = rawValue.slice(0, separatorIndex).trim() || 'unknown';
        modelId = rawValue.slice(separatorIndex + MODEL_VALUE_SEPARATOR.length).trim() || rawValue;
      } else {
        const labelMatch = option.label.match(/\(([^)]+)\)\s*$/);
        if (labelMatch?.[1]) {
          provider = labelMatch[1].trim().toLowerCase();
        } else {
          const colonIndex = rawValue.indexOf(':');
          const slashIndex = rawValue.indexOf('/');
          const splitIndex =
            colonIndex > 0 && slashIndex > 0
              ? Math.min(colonIndex, slashIndex)
              : colonIndex > 0
                ? colonIndex
                : slashIndex > 0
                  ? slashIndex
                  : -1;
          if (splitIndex > 0) {
            provider = rawValue.slice(0, splitIndex).trim().toLowerCase() || 'unknown';
            modelId = rawValue.slice(splitIndex + 1).trim() || rawValue;
          }
        }
      }

      return {
        ...option,
        provider,
        modelId,
      };
    });
  }, [models]);

  const selectedModelOption = parsedModels.find((model) => model.value === selectedModel) ?? null;
  const selectedModelLabel = selectedModelOption
    ? `${selectedModelOption.modelId} (${selectedModelOption.provider})`
    : selectedModel.trim()
      ? selectedModel.trim()
      : 'Loading models...';

  const modelProviderBuckets = useMemo(() => {
    const buckets = new Map<string, typeof parsedModels>();
    for (const item of parsedModels) {
      const key = item.provider || 'unknown';
      const current = buckets.get(key) ?? [];
      current.push(item);
      buckets.set(key, current);
    }

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return Array.from(buckets.entries())
      .map(([provider, entries]) => ({
        provider,
        entries: entries.slice().sort((a, b) => collator.compare(a.modelId, b.modelId)),
      }))
      .sort((a, b) => {
        if (selectedModelOption?.provider === a.provider) return -1;
        if (selectedModelOption?.provider === b.provider) return 1;
        return collator.compare(a.provider, b.provider);
      });
  }, [parsedModels, selectedModelOption?.provider]);

  const visibleProviderBuckets = useMemo(() => {
    const query = modelSearchQuery.trim().toLowerCase();
    if (!query) return modelProviderBuckets;

    return modelProviderBuckets
      .map((bucket) => ({
        ...bucket,
        entries: bucket.entries.filter((model) => {
          const normalizedProvider = model.provider.toLowerCase();
          const normalizedModelId = model.modelId.toLowerCase();
          const normalizedLabel = model.label.toLowerCase();
          return (
            normalizedModelId.includes(query) ||
            normalizedProvider.includes(query) ||
            normalizedLabel.includes(query)
          );
        }),
      }))
      .filter((bucket) => bucket.entries.length > 0);
  }, [modelProviderBuckets, modelSearchQuery]);

  const totalModelCount = useMemo(
    () => modelProviderBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [modelProviderBuckets],
  );
  const visibleModelCount = useMemo(
    () => visibleProviderBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [visibleProviderBuckets],
  );

  const safeContextWindowTotalTokens = Math.max(1, contextWindowTotalTokens);
  const contextWindowUsagePercent = Math.max(0, Math.min(100, Math.round((contextWindowUsedTokens / safeContextWindowTotalTokens) * 100)));
  const contextWindowUsedTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    Math.max(0, contextWindowUsedTokens),
  );
  const contextWindowTotalTokensLabel = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    safeContextWindowTotalTokens,
  );

  const mentionQuery = useMemo(() => {
    const match = composerText.match(/(^|\s)@([^\s]*)$/);
    if (!match) return null;
    return match[2] ?? '';
  }, [composerText]);

  const mentionCommands = useMemo(() => {
    if (!projectSelected || mentionQuery === null) {
      return [] as Array<{ path: string; kind: ProjectPathReference['kind']; source?: ProjectPathReference['source'] }>;
    }

    const normalizedQuery = mentionQuery.toLowerCase();
    return projectPathReferences
      .filter((entry) => {
        const normalizedPath = entry.path.toLowerCase();
        if (!normalizedQuery) return true;
        const sourceLabel = entry.source === 'external' ? 'external' : 'project';
        return normalizedPath.includes(normalizedQuery) || `${sourceLabel}/${normalizedPath}`.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const sourceA = a.source ?? 'project';
        const sourceB = b.source ?? 'project';
        if (sourceA !== sourceB) return sourceA === 'external' ? -1 : 1;
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
      })
      .slice(0, 30);
  }, [mentionQuery, projectPathReferences, projectSelected]);

  useEffect(() => {
    setComposerText(taskPrompt);
  }, [taskPrompt]);

  useEffect(() => {
    const editor = composerEditorRef.current;
    if (!editor) return;
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  }, [composerText]);

  useEffect(() => {
    setMentionMenuOpen(Boolean(projectSelected && mentionQuery !== null && mentionCommands.length > 0));
    setMentionMenuIndex(0);
  }, [mentionCommands.length, mentionQuery, projectSelected]);

  useEffect(() => {
    if (!openDropdown) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.composer-dropdown')) return;
      setOpenDropdown(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenDropdown(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [openDropdown]);

  useEffect(() => {
    if (openDropdown !== 'model') return;
    setModelSearchQuery('');
  }, [openDropdown]);

  const executeMentionCommand = (index: number) => {
    const command = mentionCommands[index];
    if (!command) return;

    const mentionPath = command.kind === 'directory' ? `${command.path}/` : command.path;
    const mentionToken = `@project:"${mentionPath}" `;
    const nextPrompt = composerText.replace(/(^|\s)@([^\s]*)$/, (full, prefix) => `${prefix}${mentionToken}`);
    setComposerText(nextPrompt);
    onTaskPromptChange(nextPrompt);

    requestAnimationFrame(() => {
      const editor = composerEditorRef.current;
      if (!editor) return;
      editor.focus();
      const nextCaret = nextPrompt.length;
      editor.setSelectionRange(nextCaret, nextCaret);
    });
    setMentionMenuOpen(false);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMenuOpen && mentionCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionMenuIndex((current) => (current + 1) % mentionCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionMenuIndex((current) => (current - 1 + mentionCommands.length) % mentionCommands.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        executeMentionCommand(mentionMenuIndex);
        return;
      }
      if (event.key === 'Escape') {
        setMentionMenuOpen(false);
        return;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    if (!canSend) return;
    formRef.current?.requestSubmit();
  };

  return (
    <div className="space-y-2">
      <form
        className="relative rounded-[18px] border border-border/75 bg-card shadow-sm"
        onSubmit={onSubmit}
        ref={formRef}
        aria-busy={sending}
      >
        {mentionMenuOpen && mentionCommands.length > 0 ? (
          <div className="absolute bottom-full left-4 z-20 mb-2 w-[min(680px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
              <p className="font-sans text-xs font-semibold tracking-wide text-foreground">References</p>
              <p className="font-sans text-[11px] text-muted-foreground">Enter to insert</p>
            </div>
            <div className="max-h-72 overflow-y-auto bg-popover p-1.5">
              {mentionCommands.map((command, index) => {
                const segments = command.path.split('/');
                const name = segments[segments.length - 1] || command.path;
                const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
                const sourceLabel = command.source === 'external' ? 'external' : 'project';

                return (
                  <button
                    key={`${command.kind}-${command.path}`}
                    type="button"
                    onClick={() => executeMentionCommand(index)}
                    className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                      index === mentionMenuIndex
                        ? 'bg-muted text-foreground ring-1 ring-border'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                      {command.kind === 'directory' ? (
                        <FolderOpen className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-sm text-foreground">{name}{command.kind === 'directory' ? '/' : ''}</span>
                      {parent ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{parent}</span> : null}
                    </span>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {sourceLabel} {command.kind === 'directory' ? '@folder' : '@file'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="relative px-4 pt-3">
          <textarea
            id={taskPromptId}
            ref={composerEditorRef}
            aria-label="Task prompt"
            placeholder="What should Relay do next?"
            value={composerText}
            onChange={(event) => {
              setComposerText(event.target.value);
              onTaskPromptChange(event.target.value);
            }}
            onKeyDown={handleComposerKeyDown}
            rows={1}
            className={`${textareaMinHeightClass} max-h-[26vh] w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-0 pb-1.5 pt-1 font-sans text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/45`}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted/70">
              <Plus className="h-4 w-4" />
            </Button>

            <div className="composer-dropdown relative">
              <button
                type="button"
                disabled={modelDropdownDisabled}
                className={`inline-flex h-7 max-w-[230px] items-center gap-1.5 rounded-md px-2 font-sans text-[11px] transition ${
                  openDropdown === 'model'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                } disabled:cursor-not-allowed disabled:opacity-60`}
                onClick={() => setOpenDropdown((current) => (current === 'model' ? null : 'model'))}
              >
                <span className="truncate">{`Model: ${selectedModelLabel}`}</span>
                <ChevronDown className="h-3 w-3 opacity-80" />
              </button>

              {openDropdown === 'model' && !modelDropdownDisabled ? (
                <div className="absolute bottom-[calc(100%+0.4rem)] left-0 z-30 w-[560px] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl">
                  <div className="border-b border-border/80 px-2.5 py-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                      <p className="font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Model selector</p>
                      <p className="font-sans text-[10px] text-muted-foreground">
                        {visibleModelCount === totalModelCount
                          ? `${totalModelCount} models`
                          : `${visibleModelCount} of ${totalModelCount}`}
                      </p>
                    </div>
                    <Input
                      value={modelSearchQuery}
                      onChange={(event) => setModelSearchQuery(event.target.value)}
                      placeholder="Search model or provider"
                      aria-label="Search models"
                      className="h-8 rounded-md border-border/80 bg-background px-2.5 py-1 text-[11px]"
                    />
                  </div>

                  <div className="max-h-[340px] overflow-y-auto p-2">
                    {visibleProviderBuckets.length === 0 ? (
                      <div className="px-2 py-5 text-center font-sans text-[11px] text-muted-foreground">
                        No models match "{modelSearchQuery.trim()}".
                      </div>
                    ) : (
                      visibleProviderBuckets.map((bucket) => (
                        <div key={bucket.provider} className="mt-2 first:mt-1">
                          <p className="px-2.5 pb-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {bucket.provider}
                          </p>
                          <Menu>
                            <MenuGroup>
                              {bucket.entries.map((model) => (
                                <MenuItem
                                  key={model.value}
                                  className={composerDropdownItemClass}
                                  active={selectedModel === model.value}
                                  onClick={() => {
                                    onModelChange(model.value);
                                    setOpenDropdown(null);
                                  }}
                                >
                                  {model.modelId}
                                </MenuItem>
                              ))}
                            </MenuGroup>
                          </Menu>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="composer-dropdown relative">
              <button
                type="button"
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-sans text-[11px] transition ${
                  openDropdown === 'effort'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
                onClick={() => setOpenDropdown((current) => (current === 'effort' ? null : 'effort'))}
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Reasoning</span>
                <span>{effortLevel === 'low' ? 'Low' : effortLevel === 'medium' ? 'Mittel' : 'High'}</span>
                <ChevronDown className="h-3 w-3 opacity-80" />
              </button>
              {openDropdown === 'effort' ? (
                <div className="absolute bottom-[calc(100%+0.3rem)] left-0 z-30 w-[136px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                  <Menu>
                    <MenuGroup>
                      {(['low', 'medium', 'high'] as const).map((value) => (
                        <MenuItem
                          key={value}
                          className={composerDropdownItemClass}
                          active={effortLevel === value}
                          onClick={() => {
                            setEffortLevel(value);
                            setOpenDropdown(null);
                          }}
                        >
                          {value === 'low' ? 'Low' : value === 'medium' ? 'Mittel' : 'High'}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                  </Menu>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="submit"
              size="icon"
              aria-label={sending ? 'Sending' : 'Send task'}
              disabled={!canSend}
              className="h-8 w-8 rounded-full border border-border/70 bg-muted text-foreground hover:bg-muted/90 disabled:text-muted-foreground"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 font-sans text-[12px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="composer-dropdown relative inline-flex items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans text-[11px] transition ${
                      openDropdown === 'approvals'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    }`}
                    onClick={() => setOpenDropdown((current) => (current === 'approvals' ? null : 'approvals'))}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>{approvalMode === 'project' ? 'Project' : approvalMode === 'none' ? 'No approvals' : 'Standard'}</span>
                    <ChevronDown className="h-3 w-3 opacity-80" />
                  </button>
                </TooltipTrigger>
                {approvalMode === 'standard' ? (
                  <TooltipContent>Standard approvals: asks for high-risk actions.</TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>

            {openDropdown === 'approvals' ? (
              <div className="absolute bottom-[calc(100%+0.3rem)] left-0 z-30 w-[176px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                <Menu>
                  <MenuGroup>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'standard'}
                      onClick={() => {
                        onApprovalModeChange('standard');
                        setOpenDropdown(null);
                      }}
                    >
                      Standard
                    </MenuItem>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'project'}
                      onClick={() => {
                        onApprovalModeChange('project');
                        setOpenDropdown(null);
                      }}
                    >
                      Project
                    </MenuItem>
                    <MenuItem
                      className={composerDropdownItemClass}
                      active={approvalMode === 'none'}
                      onClick={() => {
                        onApprovalModeChange('none');
                        setOpenDropdown(null);
                      }}
                    >
                      No approvals
                    </MenuItem>
                  </MenuGroup>
                </Menu>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="group relative">
            <button
              type="button"
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full transition hover:bg-muted/70 ${
                hermesConnected ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-300'
              }`}
              aria-label="Context window usage"
            >
              <span
                className="relative inline-block h-3.5 w-3.5 rounded-full"
                style={{
                  background: `conic-gradient(currentColor ${contextWindowUsagePercent * 3.6}deg, color-mix(in srgb, currentColor 22%, transparent) 0deg)`,
                }}
              >
                <span className="absolute inset-[2px] rounded-full bg-background" />
              </span>
            </button>
            <div className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] right-0 z-20 hidden w-[170px] rounded-xl border border-border bg-popover px-3 py-2 text-center shadow-xl group-hover:block">
              <p className="font-sans text-[11px] text-muted-foreground">Context window:</p>
              <p className="font-sans text-[11px] text-muted-foreground">{contextWindowUsagePercent}% full</p>
              <p className="mt-1 font-sans text-[11px] text-foreground">{contextWindowUsedTokensLabel} / {contextWindowTotalTokensLabel} Tokens</p>
              <p className="font-sans text-[11px] text-foreground">used</p>
              <p className="mt-1 font-sans text-[11px] text-foreground/90">Relay compacts context automatically.</p>
            </div>
          </div>
        </div>
      </div>

      {(modelsLoading || changingModel || !hasModelChoices) && (
        <div className="space-y-1 px-1">
          <p className="font-sans text-[11px] text-muted-foreground">
            {modelsLoading ? 'Loading models...' : changingModel ? 'Switching model...' : 'No models available from Hermes'}
          </p>
          {!modelsLoading && !changingModel ? <p className="font-sans text-[11px] text-muted-foreground/80">Check Hermes provider setup in WSL (`hermes model list`).</p> : null}
        </div>
      )}
    </div>
  );
}

