# Codex-Like IDE for Relay/Hermes

## Vision
Transform Relay into a Codex-like desktop IDE that lets you:
- Chat with an AI agent about code
- See real-time file edits, diffs, and execution
- Approve/reject changes with fine-grained control
- Execute code directly in project context
- Switch between multiple concurrent tasks/agents

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Relay IDE (Desktop App)                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Left Panel]        [Center]       [Right Panel]   │
│  ──────────────      ────────       ─────────────   │
│  • Project tree      • Chat UI      • File preview  │
│  • File browser      • Message      • Diff view     │
│  • Open tabs         • Input box    • Execution log │
│  • Task list                        • Approvals     │
│                                     • Terminal      │
│                                                     │
├─────────────────────────────────────────────────────┤
│            Hermes Agent Backend (Hermes)          │
│  (Executes code, reads/writes files, manages tasks) │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1: Code Editor Core (MVP)

### 1.1 Code Editor Component
- **Tool:** Monaco Editor (VS Code engine, already in use)
- **Features:**
  - Syntax highlighting for Python, TypeScript, JavaScript, Go, Rust
  - Line numbers, minimap, breadcrumbs
  - Multi-tab interface with unsaved changes indicator
  - Keyboard shortcuts (Ctrl+S, Ctrl+/, etc.)
  - Search & replace within files

### 1.2 File Tree / Project Explorer
- Browse project files in sidebar
- Click to open in editor
- Right-click context menu: New file, rename, delete (with approval)
- Show .gitignore and hidden files toggle
- Indicate file status: modified, untracked, deleted

### 1.3 Chat with Code Awareness
- User sends: "fix the auth bug in src/auth.ts"
- Agent:
  - Reads the file context
  - Plans the fix (shown to user)
  - Shows a diff preview before applying
  - User approves/rejects
  - If approved: writes changes and reports

---

## Phase 2: Execution & Approval Gates

### 2.1 Code Execution
- "Run this Python script" → Agent executes, shows stdout/stderr in execution panel
- Shell command approval: "rm -rf node_modules" pauses for your OK
- Terminal view: show executed commands, output, exit code

### 2.2 Diff View
- Before/after visualization when agent modifies a file
- Line-by-line highlighting
- One-click approve/reject on diffs

### 2.3 Inline Approvals
- High-risk actions show inline in chat:
  - File deletes
  - Shell commands
  - API calls / data exports
  - Writing to sensitive paths
- Approve button next to risk summary

---

## Phase 3: Multi-Agent & Task Management

### 3.1 Task Panel
- List of concurrent tasks/agents
- Active task indicator
- Switch between tasks without losing context
- Task status: running, waiting for approval, completed, failed

### 3.2 Agent Context
- Show which agent is currently executing
- Display agent memory/background context
- Skill availability for this agent

---

## Phase 4: Advanced Features

### 4.1 Debugging
- Breakpoints in code
- Step through execution
- Watch variables
- Debug console

### 4.2 Terminal Integration
- Full terminal emulator in right panel (xterm.js or similar)
- Execute commands live
- Capture output, stream to chat

### 4.3 Git Integration
- Diff against HEAD
- Stage/commit changes
- Branch switching
- Blame view

### 4.4 Performance Profiling
- CPU/memory usage during task execution
- Token usage tracking
- Cost breakdown per file/task

---

## Tech Stack (Building on Relay)

### Frontend (Already Set Up)
- React 19 + TypeScript
- Tailwind CSS + shadcn/ui
- Vite (hot reload)

### New Dependencies
- **monaco-editor** (~100KB) - Code editor
- **diff-match-patch** or **react-diff-view** - Diff visualization
- **xterm.js** - Terminal emulator (Phase 4)
- **zustand** - State management for multi-agent tasks (if needed)

### Backend (Hermes/Hermes)
- Already supports: file read/write, terminal execution, approval gates
- No changes needed; Relay just uses the existing API

---

## Implementation Path

### Week 1: Editor Setup
1. Add Monaco Editor component to chat page
2. Show open file tabs above editor
3. Implement file tree on left sidebar
4. Connect to Hermes file read/write API

### Week 2: Diff & Approvals
1. Build diff viewer component
2. Add approval flow for file changes
3. Show diffs inline in chat before user approves

### Week 3: Execution & Terminal
1. Add execution panel (stdout/stderr)
2. Terminal emulator component
3. Show shell commands with approval gates

### Week 4: Polish & Task Management
1. Multi-task switching
2. Task history & logs
3. Performance metrics
4. UI refinements

---

## File Structure (New)

```
src/
├── features/
│   └── ide/
│       ├── editor-page.tsx          # Main IDE view
│       ├── components/
│       │   ├── code-editor.tsx      # Monaco wrapper
│       │   ├── file-tree.tsx        # Project browser
│       │   ├── diff-viewer.tsx      # Before/after visualization
│       │   ├── terminal-panel.tsx   # Terminal emulator
│       │   └── task-panel.tsx       # Multi-task manager
│       └── hooks/
│           ├── useEditor.ts         # Editor state
│           └── useExecutor.ts       # Execution API
├── lib/
│   └── hermes-api.ts                # Hermes API wrapper (extends existing)
└── types/
    └── editor.ts                     # IDE types
```

---

## Example User Flow

### Scenario: "Add authentication to the login form"

1. **User writes:** "Add JWT token refresh logic to auth.ts"
2. **Agent plans:**
   - Open src/auth.ts
   - Identify refresh token pattern
   - Add refresh handler
3. **Agent sends diff preview** to user
4. **User reviews diff** → Clicks "Approve"
5. **Agent writes file** → Chat shows: "✅ Updated auth.ts (+12 lines)"
6. **User then says:** "Run the tests to make sure it works"
7. **Agent executes:** `npm test -- src/auth.test.ts`
8. **Output appears** in terminal panel below
9. **If tests pass:** Agent links to approval record
10. **If tests fail:** Agent shows failure reason, user can ask for fix or run debug

---

## Key Design Decisions

1. **Keep chat first:** The code editor supports the chat, not replaces it. User drives via conversation.
2. **Approval-first:** Any consequential action pauses for user review.
3. **Context-aware:** Agent has project files, git history, and execution environment in context.
4. **Transparent:** Every file change, command run, and decision is logged and attributable.
5. **Extensible:** Agent can be Claude, GPT-4, or any model — same IDE works.

---

## Success Criteria

- [ ] Open & edit a file in the IDE
- [ ] Chat with agent about code changes
- [ ] See a diff before changes are applied
- [ ] Approve/reject file changes with one click
- [ ] Execute code and see live output
- [ ] Terminal commands require approval before running
- [ ] Switch between multiple agent tasks
- [ ] Full audit trail of all actions

---

## Open Questions

1. **Monaco size:** Monaco is ~100KB. Is that acceptable, or should we use a lighter editor (CodeMirror 6)?
2. **Terminal complexity:** Full xterm.js or simpler output-only view?
3. **File sync:** Should local edits in IDE instantly sync to agent context, or only when saved?
4. **Hot reload:** Agent sees file changes in real-time, or only on explicit "refresh context"?

---

## Next Steps

1. **Create a spike:** Build a minimal editor + diff viewer component to validate UX
2. **Add Monaco to Relay:** Test import size and performance
3. **Wire approval flow:** Connect diff approval to Hermes API
4. **Test with real tasks:** Have agent edit files through the new IDE


