import { useCallback, useMemo, useState } from 'react';
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react';

import type { MemoryEntry } from '@/app-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { MEMORY_STORAGE_KEY } from '@/lib/memory-context';

type MemoryPageProps = {
  gatewayConnected: boolean;
};

const CATEGORY_CONFIG = {
  'about-me': { icon: User, label: 'About me', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  rules: { icon: BookOpen, label: 'Rules', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  knowledge: { icon: Brain, label: 'Knowledge', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  reflection: { icon: Sparkles, label: 'Reflection', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
} as const;

function loadEntriesFromStorage(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MemoryEntry[];
  } catch {
    return [];
  }
}

function saveEntriesToStorage(entries: MemoryEntry[]) {
  localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(entries));
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function MemoryPage({ gatewayConnected }: MemoryPageProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>(loadEntriesFromStorage);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<MemoryEntry['category'] | 'all'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryEntry['category']>('knowledge');
  const [editTags, setEditTags] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const persist = useCallback((updated: MemoryEntry[]) => {
    setEntries(updated);
    saveEntriesToStorage(updated);
  }, []);

  const handleAdd = useCallback(() => {
    if (!editTitle.trim()) return;
    const now = Date.now();
    const entry: MemoryEntry = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 8)}`,
      category: editCategory,
      title: editTitle.trim(),
      content: editContent.trim(),
      tags: editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      createdAt: now,
      updatedAt: now,
    };
    persist([entry, ...entries]);
    setEditTitle('');
    setEditContent('');
    setEditTags('');
    setShowAddForm(false);
  }, [editTitle, editContent, editCategory, editTags, entries, persist]);

  const handleUpdate = useCallback(
    (id: string) => {
      const updated = entries.map((e) =>
        e.id === id
          ? {
              ...e,
              title: editTitle.trim() || e.title,
              content: editContent.trim(),
              category: editCategory,
              tags: editTags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
              updatedAt: Date.now(),
            }
          : e,
      );
      persist(updated);
      setEditingId(null);
    },
    [entries, editTitle, editContent, editCategory, editTags, persist],
  );

  const handleDelete = useCallback(
    (id: string) => {
      persist(entries.filter((e) => e.id !== id));
    },
    [entries, persist],
  );

  const startEdit = useCallback((entry: MemoryEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditContent(entry.content);
    setEditCategory(entry.category);
    setEditTags(entry.tags.join(', '));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let result = entries;
    if (categoryFilter !== 'all') {
      result = result.filter((e) => e.category === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [entries, categoryFilter, searchQuery]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = { 'about-me': 0, rules: 0, knowledge: 0, reflection: 0 };
    for (const e of entries) stats[e.category] = (stats[e.category] || 0) + 1;
    return stats;
  }, [entries]);

  return (
    <section className="grid h-full w-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="size-5 text-purple-600" />
            <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
          </div>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Personal knowledge, rules, and reflections - your agent keeps learning continuously.
          </p>
        </div>
        <Button
          type="button"
          variant={showAddForm ? 'outline' : 'default'}
          className="gap-1.5"
          onClick={() => {
            setShowAddForm(!showAddForm);
            setEditingId(null);
          }}
        >
          {showAddForm ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {showAddForm ? 'Cancel' : 'New entry'}
        </Button>
      </header>

      {/* Category stats */}
      <div className="grid grid-cols-4 gap-2">
        {(Object.entries(CATEGORY_CONFIG) as [MemoryEntry['category'], (typeof CATEGORY_CONFIG)[MemoryEntry['category']]][]).map(
          ([key, conf]) => {
            const CatIcon = conf.icon;
            const count = categoryStats[key] || 0;
            const isActive = categoryFilter === key;
            return (
              <button
                key={key}
                type="button"
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'border-foreground/20 bg-accent shadow-sm'
                    : 'border-border/60 bg-card hover:bg-accent/40'
                }`}
                onClick={() => setCategoryFilter(isActive ? 'all' : key)}
              >
                <div className={`flex size-8 items-center justify-center rounded-lg ${conf.bg}`}>
                  <CatIcon className={`size-4 ${conf.color}`} />
                </div>
                <div>
                  <p className="font-sans text-[12px] font-medium">{conf.label}</p>
                  <p className="font-sans text-[11px] text-muted-foreground">{count} entries</p>
                </div>
              </button>
            );
          },
        )}
      </div>

      {/* Add form + list */}
      <div className="flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
        {/* Add form */}
        {showAddForm && (
          <>
            <div className="grid gap-3 border-b border-border/40 p-4">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title..."
                  className="h-8 text-[13px]"
                />
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as MemoryEntry['category'])}
                  className="h-8 rounded-md border border-border bg-background px-2 font-sans text-[12px]"
                >
                  {Object.entries(CATEGORY_CONFIG).map(([key, conf]) => (
                    <option key={key} value={key}>
                      {conf.label}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Content... Markdown is supported."
                className="min-h-[80px] resize-none text-[13px]"
              />
              <div className="flex items-center gap-2">
                <Tag className="size-3.5 text-muted-foreground/60" />
                <Input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="Tags (comma separated)..."
                  className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
                />
                <Button type="button" size="sm" onClick={handleAdd} disabled={!editTitle.trim()} className="ml-auto gap-1">
                  <Plus className="size-3" />
                  Save
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
          <Search className="size-3.5 text-muted-foreground/60" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memory..."
            className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
          />
          {searchQuery && (
            <Button type="button" variant="ghost" size="icon-xs" className="size-5" onClick={() => setSearchQuery('')}>
              <X className="size-3" />
            </Button>
          )}
          <span className="ml-auto whitespace-nowrap font-sans text-[11px] text-muted-foreground">
            {filtered.length} von {entries.length}
          </span>
        </div>

        {/* Entries list */}
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Brain className="mb-3 size-8 text-muted-foreground/30" />
              <p className="font-sans text-sm text-muted-foreground">
                {entries.length === 0
                  ? 'No memory entries yet. Create your first entry above.'
                  : 'No matches for this filter.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map((entry) => {
                const conf = CATEGORY_CONFIG[entry.category];
                const CatIcon = conf.icon;
                const isExpanded = expandedIds.has(entry.id);
                const isEditing = editingId === entry.id;

                if (isEditing) {
                  return (
                    <div key={entry.id} className="grid gap-2 bg-accent/20 p-4">
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-8 text-[13px]"
                        />
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as MemoryEntry['category'])}
                          className="h-8 rounded-md border border-border bg-background px-2 font-sans text-[12px]"
                        >
                          {Object.entries(CATEGORY_CONFIG).map(([key, c]) => (
                            <option key={key} value={key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-[60px] resize-none text-[13px]"
                      />
                      <div className="flex items-center gap-2">
                        <Tag className="size-3.5 text-muted-foreground/60" />
                        <Input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          className="h-7 border-0 bg-transparent px-0 text-[12px] shadow-none focus-visible:ring-0"
                        />
                        <div className="ml-auto flex items-center gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button type="button" size="sm" onClick={() => handleUpdate(entry.id)}>
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={entry.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${conf.bg}`}
                      >
                        <CatIcon className={`size-3.5 ${conf.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="flex items-center gap-1 text-left"
                            onClick={() => toggleExpand(entry.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-3 text-muted-foreground" />
                            )}
                            <span className="font-sans text-[13px] font-medium">{entry.title}</span>
                          </button>
                          <Badge variant="outline" className="font-sans text-[10px]">
                            {conf.label}
                          </Badge>
                          <span className="ml-auto font-sans text-[10px] text-muted-foreground/60">
                            {timeAgo(entry.updatedAt)}
                          </span>
                        </div>

                        {isExpanded && entry.content && (
                          <p className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] text-foreground/80 leading-relaxed">
                            {entry.content}
                          </p>
                        )}

                        {entry.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {entry.tags.map((tag) => (
                              <Badge key={tag} variant="outline" className="font-sans text-[10px] text-muted-foreground">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button type="button" variant="ghost" size="icon-xs" className="size-6" onClick={() => startEdit(entry)}>
                          <Edit3 className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="size-6 text-destructive/60 hover:text-destructive"
                          onClick={() => handleDelete(entry.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </section>
  );
}
